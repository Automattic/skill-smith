export type AnsiColor = 'red' | 'green' | 'yellow' | 'cyan' | 'gray';

const ANSI_CODES: Record< AnsiColor, string > = {
	red: '31',
	green: '32',
	yellow: '33',
	cyan: '36',
	gray: '90',
};

export function paint(
	text: string,
	color: AnsiColor | undefined,
	enabled: boolean
): string {
	if ( ! enabled || ! color ) return text;
	return `\x1b[${ ANSI_CODES[ color ] }m${ text }\x1b[0m`;
}

export function shouldUseColor( stream: NodeJS.WritableStream ): boolean {
	const noColor = process.env.NO_COLOR !== undefined;
	const isTty =
		'isTTY' in stream && ( stream as { isTTY?: boolean } ).isTTY === true;
	return isTty && ! noColor;
}
