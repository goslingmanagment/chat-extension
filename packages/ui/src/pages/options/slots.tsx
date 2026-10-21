// The places a site puts its own part of the settings page (R20 P14b1; docs/project-unite/architecture.md §1.5,
// §1.7 «Только Fansly»; FS-SET-1): the sections stay shared (X32), a site adds rows and a card to them. The shared page
// names no site — the composition root hands in the site's components (Fansly's: ui/hosts/fansly/pages), each drawn
// where its slot stands, or nothing.

import { createContext, type ComponentType, type JSX } from 'preact';
import { useContext } from 'preact/hooks';

export interface OptionsSlots {
  /** «Аккаунты», above the groups of accounts: the site's card (switching it on, its tabs). */
  readonly accounts?: ComponentType;
  /** «Генерация», inside the card of the message windows, after its steppers. */
  readonly generationWindows?: ComponentType;
  /** «Вид и звук», inside the card «Звук», after the two sounds. */
  readonly appearanceSound?: ComponentType;
  /** The sign-in screen, after the first-run steps. */
  readonly signIn?: ComponentType;
  /** The first-run checklist, after its own steps (ST-012). */
  readonly checklist?: ComponentType;
  /** «Персоны», under the card of the pages: the site's own way to their personas (Fansly: the old extension's, audit №9). */
  readonly personas?: ComponentType;
}

export type OptionsSlotName = keyof OptionsSlots;

const SlotsContext = createContext<OptionsSlots>({});

export const OptionsSlotsProvider = SlotsContext.Provider;

/** The site's component of this slot, or nothing. */
export function Slot({ name }: { readonly name: OptionsSlotName }): JSX.Element | null {
  const View = useContext(SlotsContext)[name];
  return View === undefined ? null : <View />;
}
