// Module variant with a STATIC import (only valid with background.type "module").
import { start } from './bg/ok.js';
globalThis.__staticChunk = typeof start;
