import { openai } from '@ai-sdk/openai';
import { runVercel } from './lib/vercel-runner';
import type { Provider } from './types';

export const openaiApiProvider: Provider = {
	id: 'openai-api',
	requiredEnv: 'OPENAI_API_KEY',
	invoke: ( params ) => {
		if ( ! process.env.OPENAI_API_KEY ) {
			return Promise.resolve( {
				finalText: '',
				toolUseCount: 0,
				error: 'OPENAI_API_KEY is not set',
			} );
		}
		return runVercel( params, openai( params.agent.model ) );
	},
};
