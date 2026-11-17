import type { BlockSheetProps } from './BlockSheet';
import { lazySheet } from './lazySheet';
import type { NoShowSheetProps } from './NoShowSheet';
import type { ReportSheetProps } from './ReportSheet';
import type { ShareSheetProps } from './ShareSheet';

/** Safety sheets, each its own lazy chunk loaded on first open. */
export const LazyReportSheet = lazySheet<ReportSheetProps>(() => import('./ReportSheet'));
export const LazyBlockSheet = lazySheet<BlockSheetProps>(() => import('./BlockSheet'));
export const LazyNoShowSheet = lazySheet<NoShowSheetProps>(() => import('./NoShowSheet'));
export const LazyShareSheet = lazySheet<ShareSheetProps>(() => import('./ShareSheet'));
