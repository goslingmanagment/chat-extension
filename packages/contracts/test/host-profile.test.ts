// The site's profile for our interface (src/vm/host-profile.ts, 1.15.0, R20 F5; docs/project-unite/architecture.md
// §1.5): the dock's variants, the attribute the mount puts on our host, and what a profile may and may not say.

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as C from '../src/index';
import { HOST_PROFILE_SAMPLES } from './fixtures/host-profile';

describe('[R20-F5] the site’s profile', () => {
  it('two variants of the dock, one per site, each once', () => {
    expect(C.DOCK_VARIANTS).toEqual(['chatspace', 'fansly']);
    expectTypeOf<C.DockVariant>().toEqualTypeOf<'chatspace' | 'fansly'>();
  });

  it('the variant goes on our host under a neutral name, next to `data-scheme` (X22: the page sees it)', () => {
    expect(C.DOCK_VARIANT_ATTRIBUTE).toBe('data-dock-variant');
    for (const name of [C.DOCK_VARIANT_ATTRIBUTE, C.SCHEME_ATTRIBUTE]) expect(name).not.toMatch(/chatgoose|goose|\bcg\b|cg-/i);
  });

  it('the samples: ChatSpace with the page’s own palette, a second site with its palette and its sheet; phrases in every language', () => {
    expect(HOST_PROFILE_SAMPLES.valid).toHaveLength(3);
    for (const profile of HOST_PROFILE_SAMPLES.valid) {
      expect(Object.keys(profile.phrases).sort()).toEqual([...C.LOCALES].sort());
      for (const name of Object.keys(profile.palette?.value ?? {})) expect(name).toMatch(/^--color-om-[a-z0-9-]+$/);
    }
    // The compiler refuses each invalid sample (`@ts-expect-error` in the fixture); here, that there are some.
    expect(HOST_PROFILE_SAMPLES.invalid.length).toBeGreaterThanOrEqual(8);
  });

  it('[R20-F9b] the phrases are the placeholders the shared texts say instead of a site’s name, each a text in every language', () => {
    expect(C.HOST_PHRASE_NAMES).toEqual(['site', 'onSite', 'siteAccount', 'sitePlatform']);
    expectTypeOf<keyof C.HostPhrases>().toEqualTypeOf<(typeof C.HOST_PHRASE_NAMES)[number]>();
    for (const profile of HOST_PROFILE_SAMPLES.valid) {
      for (const locale of C.LOCALES) {
        expect(Object.keys(profile.phrases[locale]).sort(), locale).toEqual([...C.HOST_PHRASE_NAMES].sort());
        for (const name of C.HOST_PHRASE_NAMES) expect(profile.phrases[locale][name].trim(), `${locale} ${name}`).not.toBe('');
      }
    }
  });

  it('a mount without a profile is still a mount: the field is optional in MountDeps (an extension page has no site)', () => {
    expectTypeOf<C.MountDeps['profile']>().toEqualTypeOf<C.HostUiProfile | undefined>();
  });
});
