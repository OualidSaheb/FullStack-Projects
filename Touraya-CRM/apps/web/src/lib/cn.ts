import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins classes; later Tailwind utilities override earlier ones (e.g. a caller's w-40 beats w-full). */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
