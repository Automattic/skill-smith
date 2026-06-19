import { renderSnapshot } from './render';
import type {
	Failure,
	PhaseName,
	RunCounters,
	RunSnapshot,
	TerminalStatus,
} from './types';

export interface TrackerInit {
	runId: string;
	scenarios: { name: string; agentIds: string[] }[];
}

export interface TrackerOptions {
	stream?: NodeJS.WritableStream;
	color?: boolean;
	/**
	 * When true, repaints overwrite the prior block in place using ANSI
	 * cursor escapes. Defaults to true when the stream is a TTY. Set
	 * false when something else may write to the same stream (e.g.
	 * verbose log mirroring) — otherwise the cursor math gets garbled.
	 */
	interactive?: boolean;
	/**
	 * Minimum milliseconds between repaints in interactive mode. The
	 * first event paints immediately; subsequent events are coalesced
	 * until the throttle elapses. `finish()` always paints. Defaults
	 * to 200 ms.
	 */
	throttleMs?: number;
	/**
	 * Wall-clock repaint interval in interactive mode, used to refresh
	 * the elapsed/ETA line even while no scenario events arrive. Set
	 * to 0 to disable. Defaults to 1000 ms. Ticks are skipped until the
	 * first event-driven paint and stop when `finish()` is called.
	 */
	tickMs?: number;
	/** Override `Date.now()` — used by tests. */
	now?: () => number;
}

export interface PhaseResult {
	status: TerminalStatus;
	durationMs?: number;
	detail?: string;
}

interface ScenarioState {
	name: string;
	agentIds: string[];
	skipped: boolean;
	skipReason?: string;
	/** False when this scenario is not part of the current iteration's
	 * selection; inactive scenarios are excluded from the counters. */
	active: boolean;
	phases: Map< string, { testing: PhaseSlot; judge: PhaseSlot } >;
}

type PhaseSlot = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

/**
 * Owns the run's aggregate counters and failures list. Repaints a
 * compact dashboard block to `stream` (default stderr), overwriting
 * the prior block in interactive mode.
 */
export class ProgressTracker {
	private readonly stream: NodeJS.WritableStream;
	private readonly color: boolean;
	private readonly interactive: boolean;
	private readonly throttleMs: number;
	private readonly tickMs: number;
	private readonly nowFn: () => number;
	private readonly runId: string;
	private readonly startedAt: number;
	private readonly scenarios: Map< string, ScenarioState >;
	private failures: Failure[] = [];
	private finished = false;
	private iteration: { current: number; total: number } | undefined;

	private lastPaintAt = 0;
	private lastPaintedLines = 0;
	private pendingTimer: NodeJS.Timeout | null = null;
	private tickTimer: NodeJS.Timeout | null = null;

	constructor( init: TrackerInit, opts: TrackerOptions = {} ) {
		this.stream = opts.stream ?? process.stderr;
		this.color = opts.color ?? defaultColor( this.stream );
		this.interactive = opts.interactive ?? isTty( this.stream );
		this.throttleMs = opts.throttleMs ?? 200;
		this.tickMs = opts.tickMs ?? 1000;
		this.nowFn = opts.now ?? ( () => Date.now() );
		this.runId = init.runId;
		this.startedAt = this.nowFn();
		this.scenarios = new Map(
			init.scenarios.map( ( s ) => [
				s.name,
				{
					name: s.name,
					agentIds: s.agentIds,
					skipped: false,
					active: true,
					phases: new Map(
						s.agentIds.map( ( id ) => [
							id,
							{ testing: 'pending', judge: 'pending' },
						] )
					),
				},
			] )
		);

		if ( this.interactive && this.tickMs > 0 ) {
			this.tickTimer = setInterval( () => this.onTick(), this.tickMs );
			if ( typeof this.tickTimer.unref === 'function' ) {
				this.tickTimer.unref();
			}
		}
	}

	/**
	 * Begin a new iteration of the self-improvement loop. Resets every
	 * scenario's phase slots to pending and clears the failures list so
	 * the dashboard reflects only this iteration's progress. When
	 * `activeScenarios` is given, scenarios outside it are marked
	 * inactive and excluded from the counters (subset iterations re-run
	 * only the previously-failing scenarios).
	 */
	beginIteration(
		current: number,
		total: number,
		activeScenarios?: string[]
	): void {
		this.iteration = { current, total };
		const activeSet =
			activeScenarios === undefined
				? undefined
				: new Set( activeScenarios );
		this.failures = [];
		for ( const s of this.scenarios.values() ) {
			s.active = activeSet === undefined || activeSet.has( s.name );
			s.skipped = false;
			s.skipReason = undefined;
			for ( const slots of s.phases.values() ) {
				slots.testing = 'pending';
				slots.judge = 'pending';
			}
		}
		this.requestPaint();
	}

	private onTick(): void {
		if ( this.finished ) return;
		// Skip until first event-driven paint so we don't display an
		// empty block before anything has happened.
		if ( this.lastPaintAt === 0 ) return;
		this.flush();
	}

	scenarioSkipped( name: string, reason: string ): void {
		const s = this.scenario( name );
		if ( s.skipped ) return;
		s.skipped = true;
		s.skipReason = reason;
		this.failures.push( {
			scenario: name,
			agentId: '—',
			phase: undefined,
			detail: reason,
		} );
		this.requestPaint();
	}

	phaseStarted(
		scenarioName: string,
		agentId: string,
		phase: PhaseName
	): void {
		const s = this.scenario( scenarioName );
		if ( s.skipped ) return;
		const slots = this.slots( s, agentId );
		slots[ phase ] = 'running';
		this.requestPaint();
	}

	phaseFinished(
		scenarioName: string,
		agentId: string,
		phase: PhaseName,
		result: PhaseResult
	): void {
		const s = this.scenario( scenarioName );
		if ( s.skipped ) return;
		const slots = this.slots( s, agentId );
		slots[ phase ] = result.status;
		if ( result.status === 'failed' ) {
			this.failures.push( {
				scenario: scenarioName,
				agentId,
				phase,
				detail: result.detail ?? '(no detail)',
			} );
		}
		this.requestPaint();
	}

	finish(): void {
		this.finished = true;
		if ( this.pendingTimer ) {
			clearTimeout( this.pendingTimer );
			this.pendingTimer = null;
		}
		if ( this.tickTimer ) {
			clearInterval( this.tickTimer );
			this.tickTimer = null;
		}
		this.flush();
	}

	private requestPaint(): void {
		if ( this.finished ) return;
		const now = this.nowFn();
		const sinceLast = now - this.lastPaintAt;
		if ( this.lastPaintAt === 0 || sinceLast >= this.throttleMs ) {
			this.flush();
			return;
		}
		if ( this.pendingTimer ) return;
		this.pendingTimer = setTimeout(
			() => {
				this.pendingTimer = null;
				this.flush();
			},
			Math.max( 0, this.throttleMs - sinceLast )
		);
	}

	private flush(): void {
		this.lastPaintAt = this.nowFn();
		const snapshot: RunSnapshot = {
			runId: this.runId,
			startedAt: this.startedAt,
			now: this.lastPaintAt,
			iteration: this.iteration,
			counters: this.counters(),
			failures: this.failures.slice(),
			finished: this.finished,
		};
		const block = renderSnapshot( snapshot, { color: this.color } );
		if ( this.interactive ) {
			const erase =
				this.lastPaintedLines > 0
					? `\x1b[${ this.lastPaintedLines }A\x1b[0J`
					: '';
			this.stream.write( `${ erase }${ block }\n` );
			this.lastPaintedLines = terminalRows( block, this.streamColumns() );
		} else if ( this.finished ) {
			this.stream.write( `${ block }\n` );
		}
	}

	private streamColumns(): number {
		const cols = ( this.stream as { columns?: unknown } ).columns;
		return typeof cols === 'number' && cols > 0 ? cols : 80;
	}

	private counters(): RunCounters {
		let activeScenarios = 0;
		for ( const s of this.scenarios.values() ) {
			if ( s.active ) activeScenarios++;
		}
		const sc = {
			total: activeScenarios,
			passed: 0,
			failed: 0,
			skipped: 0,
			running: 0,
			pending: 0,
		};
		const ph = {
			total: 0,
			passed: 0,
			failed: 0,
			skipped: 0,
			running: 0,
			pending: 0,
		};
		for ( const s of this.scenarios.values() ) {
			if ( ! s.active ) continue;
			if ( s.skipped ) {
				sc.skipped++;
				ph.total += s.agentIds.length * 2;
				ph.skipped += s.agentIds.length * 2;
				continue;
			}
			let anyRunning = false;
			let anyTerminal = false;
			let anyFailed = false;
			let allTerminal = true;
			for ( const slots of s.phases.values() ) {
				ph.total += 2;
				for ( const slot of [ slots.testing, slots.judge ] ) {
					if ( slot === 'passed' ) {
						ph.passed++;
						anyTerminal = true;
					} else if ( slot === 'failed' ) {
						ph.failed++;
						anyTerminal = true;
						anyFailed = true;
					} else if ( slot === 'skipped' ) {
						ph.skipped++;
						anyTerminal = true;
					} else if ( slot === 'running' ) {
						ph.running++;
						anyRunning = true;
						allTerminal = false;
					} else {
						ph.pending++;
						allTerminal = false;
					}
				}
			}
			if ( allTerminal ) {
				if ( anyFailed ) sc.failed++;
				else sc.passed++;
			} else if ( anyRunning || anyTerminal ) {
				sc.running++;
			} else {
				sc.pending++;
			}
		}
		return { scenarios: sc, phases: ph };
	}

	private scenario( name: string ): ScenarioState {
		const s = this.scenarios.get( name );
		if ( ! s ) throw new Error( `progress: unknown scenario "${ name }"` );
		return s;
	}

	private slots(
		s: ScenarioState,
		agentId: string
	): { testing: PhaseSlot; judge: PhaseSlot } {
		const slots = s.phases.get( agentId );
		if ( ! slots ) {
			throw new Error(
				`progress: unknown agent "${ agentId }" in scenario "${ s.name }"`
			);
		}
		return slots;
	}
}

function isTty( stream: NodeJS.WritableStream ): boolean {
	return (
		'isTTY' in stream && ( stream as { isTTY?: boolean } ).isTTY === true
	);
}

function defaultColor( stream: NodeJS.WritableStream ): boolean {
	const noColor = process.env.NO_COLOR !== undefined;
	return isTty( stream ) && ! noColor;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matches real ANSI SGR escape sequences; the ESC byte (0x1b) is the intended content used to strip colour codes when measuring printed width.
const ANSI_SGR = /\x1b\[[0-9;]*m/g;

function visibleWidth( line: string ): number {
	return line.replace( ANSI_SGR, '' ).length;
}

/**
 * Count terminal rows the block actually occupies once the stream wraps
 * lines wider than `columns`. The bug being fixed: `block.split("\n").length`
 * undercounts when a failure detail wraps, so the next paint's `\x1b[NA`
 * walks up too few rows and leaves the top of the previous dashboard intact.
 */
function terminalRows( block: string, columns: number ): number {
	let rows = 0;
	for ( const line of block.split( '\n' ) ) {
		const w = visibleWidth( line );
		rows += w === 0 ? 1 : Math.ceil( w / columns );
	}
	return rows;
}
