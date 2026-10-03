import { z } from 'zod';
import { isValidDate } from '../core/dates';

export const zDate = z.string().refine(isValidDate, 'fecha no válida (AAAA-MM-DD)');
export const zId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const zCents = z.number().int().min(0).max(100_000_000);
export const zName = z.string().trim().min(1).max(120);
