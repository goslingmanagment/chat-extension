// 1.15.0, R20 P11a: the header's own client, like the vault's; no DOM or network.
import type { CgAnyErrorWire } from './errors-fansly';

export interface RegistrationTarget {
  readonly accountId: string;
  readonly loginEpoch: string;
  readonly groupId: string;
  readonly fanId: string | null;
}

export interface RegistrationView {
  readonly state: 'idle' | 'loading' | 'shown' | 'failed';
  readonly registeredAt: number | null;
  readonly error: CgAnyErrorWire | null;
}

export interface RegistrationClient {
  view(): RegistrationView;
  subscribe(listener: (view: RegistrationView) => void): () => void;
  reveal(): Promise<void>;
}

/** The header's full date and calendar age: a host-local i18n port. */
export interface RegistrationI18n {
  date(at: number, locale: 'ru' | 'en'): string;
  time(at: number, locale: 'ru' | 'en'): string;
  age(at: number, now: number, locale: 'ru' | 'en'): string;
}
