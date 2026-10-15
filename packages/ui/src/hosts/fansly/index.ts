// Subpath only: the Fansly application and galleries, never a shared UI barrel.
import type { HostSheet } from '@cg/contracts/vm';
import css from './dock.css?inline';

export const FANSLY_DOCK_SHEET: HostSheet = { id: 'cg-fansly-dock', css };
