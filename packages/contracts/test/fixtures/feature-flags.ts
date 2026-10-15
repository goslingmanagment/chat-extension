// Test-only complement of the explicit ChatSpace allowlist; new flags are excluded by default.
import { CHATSPACE_FEATURE_FLAGS } from '../../src/features/chatspace';
import { CLIENT_FEATURE_FLAG_NAMES } from '../../src/hub/wire';

export const NON_CHATSPACE_FEATURE_FLAGS = CLIENT_FEATURE_FLAG_NAMES.filter((flag) => !(CHATSPACE_FEATURE_FLAGS as readonly string[]).includes(flag));
