import { SEED_FIGURES } from '@clear/command-types';
import { REAL } from './env';

/**
 * The figures the sections draw that aren't counted from their rows (command.figures on the API).
 * The preview starts with the seed values, the prototype's own numbers; the live app starts empty
 * and takes each section's figures as the section loads.
 */
const FIG: Record<string, unknown> = REAL ? {} : { ...SEED_FIGURES };

export const setFigures = (f: Record<string, unknown>) => Object.assign(FIG, f);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fig = (key: string): any => FIG[key];
