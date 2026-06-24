/**
 * Build the `--project` flags that restrict a Playwright run to the
 * runnable agents. Only ids that are also configured project names are
 * forwarded, so a skipped or unknown id can never surface as an
 * "unknown project" error. Returns a flat arg list ready to append to
 * the spawned `playwright test` command.
 */
export function projectArgs(
	runnableAgentIds: string[],
	configuredProjectNames: string[]
): string[] {
	const configured = new Set( configuredProjectNames );
	return runnableAgentIds
		.filter( ( id ) => configured.has( id ) )
		.flatMap( ( id ) => [ '--project', id ] );
}
