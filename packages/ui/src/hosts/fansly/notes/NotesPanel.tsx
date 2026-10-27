// The «Заметки» panel of a Fansly tab (FS-NOTE-2…6): the fan's native Fansly notes on one screen (2026-10-26, the
// owner: «полностью с нуля переработал»), its model the panel's own client (contracts notes-fansly.ts); nothing here
// reads the page or the network.
//
// - The head: the name for oneself, edited in place (Enter or leaving the field saves a changed name, Esc reverts it,
//   an empty one deletes it), the fan's @handle, «Обновить», «Где показывать» (the view, ⌘⇧K), «Закрыть».
// - «Анкета»: a table, the label, its facts, the month a fact was said at the right. A click on a row opens that field in
//   place, one fact per line: Enter writes it to Fansly, Esc puts it away. The fields with nothing written are «+ Метка».
//   «Править текстом» and «Удалить анкету» under the table.
// - Filling it from the chat is the main way (the owner, 2026-10-27: «это основная фича»): a fan without a
//   questionnaire gets a card with «✨ Заполнить из чата» (and «Заполнить вручную» for the fields); a filled one has
//   «✨ Дополнить из чата» in the section's head. While the hub reads the chat, its stage line and «Остановить»; then
//   (of six prototypes the owner chose «Подсказки прямо в строках»; «чаттер должен контролировать, что он делает»)
//   each finding stands in its field's row as a pill in the AI serif: after the words it extends, as a new line, or as
//   a faint row of its own. A press or Enter writes that one to Fansly, × or Backspace puts it aside, the fan's words on
//   hover; «Гусь предлагает N · Принять все · Скрыть» over the rows, «Записано: … · Отменить» for a few seconds after a
//   ✓, «Заменить?» on a row changed since the Goose read it. The fields written are marked ✦.
// - The prototype's motion came with it (the owner, 2026-10-27: «показывал анимацию прикольную, а по итогу её нет»): a
//   warm band sweeps the table while the Goose reads, the pills come in one after another, a ✓ dissolves the pill's
//   frame into the row's own words that land with a warm glow and a short ✓, a × fades the pill out, the rows glide to
//   their new places and a field's «+ Метка» flies up into its row (`useFlip`). None of it under reduced motion.
// - While the Goose works, its line says where it is (the owner: «прогресс какой-то», «1 этап улучшить тоже»): «Собираю
//   переписку…», «Читаю переписку: 860 сообщений…» (the hub's count), then «Сверяю с анкетой: Хобби · 6 из 11 · нашёл
//   3» with a filling bar, the field it is on lit, a quiet ✓ on one with nothing new, and what it found standing in
//   its row at once, not yet to take («ещё пишется»).
// - «Заметки»: a box at the top (a line typed and Enter makes a note), then the notes, newest first, the date at the
//   left; «Изменить» and «Удалить» on a note under the pointer. FBuddy's note and a long one are read only.

import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { I18nKey } from '@cg/contracts/errors';
import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import { cgTitleKey } from '@cg/contracts/i18n/keys';
import type { NotesClient, NotesCopy, NotesDateVM, NotesEditorVM, NotesFactVM, NotesFieldVM, NotesFillProgressVM, NotesFillVM, NotesFormPartVM, NotesFormVM, NotesItemVM, NotesPanelVM, NotesProblem, NotesQuickVM, NotesSuggestionVM } from '@cg/contracts/notes-fansly';
import { FANSLY_NOTES_VIEWS, type FanslyNotesView } from '@cg/contracts/settings-ext';

import { Button, Dot, ElapsedTimer, Icon, Menu, MenuAnchor, StageLine, TextField, hotkeyText, isComposing, menuTriggerKeys, useI18n, useKit, useReducedMotion } from '../../../kit';
import { useNotesTick, type NotesTexts } from './NotesButton';

type Props = { readonly client: NotesClient; readonly copy: NotesCopy };
type TextElement = HTMLInputElement | HTMLTextAreaElement;

function useErrorText(): (error: CgAnyErrorWire) => string {
  const i18n = useI18n();
  return (error) => `${i18n.t(cgTitleKey(error.code) as I18nKey)} · ${error.code}`;
}

/** The key that saves a note's text: ⌘↵ on a Mac, Ctrl+↵ elsewhere (as the notes' own ⌘⇧K tells). */
function useSaveKey(): string {
  const { deps } = useKit();
  return hotkeyText(deps.catalog.entry('notes').hotkey)?.display.includes('⌘') === true ? '⌘↵' : 'Ctrl+↵';
}

/** The caret at the end of a box that just opened. */
function useFocusAtEnd(ref: { readonly current: TextElement | null }, key: unknown): void {
  useEffect(() => {
    const field = ref.current;
    if (field === null) return;
    field.focus({ preventScroll: false });
    field.setSelectionRange(field.value.length, field.value.length);
  }, [key]);
}

const EASE = 'cubic-bezier(.2, .7, .3, 1)';

/**
 * The questionnaire moves instead of jumping: a block marked `data-flip` glides from where it stood before a change,
 * one that appears fades in, and a row that took a «+ Метка» chip's place flies its label up from the chip. Measured
 * against the section after every render; nothing moves under reduced motion or when the panel changed its width (its
 * view).
 */
function useFlip(root: { readonly current: HTMLElement | null }, still: boolean): void {
  const last = useRef<{ readonly width: number; readonly at: ReadonlyMap<string, { readonly x: number; readonly y: number }> } | null>(null);
  useLayoutEffect(() => {
    const host = root.current;
    if (host === null) return;
    const base = host.getBoundingClientRect();
    const blocks = [...host.querySelectorAll<HTMLElement>('[data-flip]')];
    const at = new Map<string, { readonly x: number; readonly y: number }>();
    for (const block of blocks) {
      const box = block.getBoundingClientRect();
      at.set(block.dataset['flip'] ?? '', { x: box.left - base.left, y: box.top - base.top });
    }
    const before = last.current;
    last.current = { width: base.width, at };
    if (still || before === null || Math.abs(before.width - base.width) > 1 || typeof host.animate !== 'function') return;
    for (const block of blocks) {
      const key = block.dataset['flip'] ?? '';
      const now = at.get(key);
      const was = before.at.get(key);
      if (now === undefined) continue;
      if (was !== undefined) {
        const dx = was.x - now.x;
        const dy = was.y - now.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) block.animate([{ transform: `translate(${String(dx)}px, ${String(dy)}px)` }, { transform: 'none' }], { duration: 300, easing: EASE });
        continue;
      }
      const chip = key.startsWith('row:') ? before.at.get(`chip:${key.slice(4)}`) : undefined;
      const label = chip === undefined ? null : block.querySelector<HTMLElement>('.cg-notes__label');
      if (chip !== undefined && label !== null) {
        const box = label.getBoundingClientRect();
        label.animate([{ transform: `translate(${String(chip.x + 18 - (box.left - base.left))}px, ${String(chip.y + 3 - (box.top - base.top))}px)`, opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 460, easing: EASE });
      } else block.animate([{ opacity: 0, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE });
    }
  });
}

function NameField({ client, copy, vm, onFocused }: Props & { readonly vm: NotesPanelVM; readonly onFocused: (focused: boolean) => void }): JSX.Element {
  const status = vm.name.status;
  const locked = status === 'saving' || status === 'unconfirmed';
  const input = useRef<HTMLInputElement | null>(null);
  // The fan's own name stands in the field until a name for oneself is typed: it reads as the name, not as a hint.
  // The field is as wide as what it shows (its box mirrors the text), so the pencil stands right after the name.
  const shown = vm.name.value || vm.fan?.name || copy.namePlaceholder;
  return (
    <span class="cg-notes__namebox" data-value={shown}>
      <input
        ref={input}
        class="cg-notes__name"
        type="text"
        value={vm.name.value}
        placeholder={vm.fan?.name ?? copy.namePlaceholder}
        {...(vm.fan?.name === undefined || vm.fan.name === null ? {} : { 'data-notes-fan-name': '' })}
        aria-label={copy.namePlaceholder}
        title={copy.nameHint}
        data-notes-name=""
        size={1}
        {...(locked ? { readOnly: true, 'aria-busy': 'true' } : {})}
        onFocus={() => onFocused(true)}
        onBlur={() => {
          onFocused(false);
          client.dispatch({ type: 'name-commit' });
        }}
        onInput={(event) => client.dispatch({ type: 'name-input', value: event.currentTarget.value })}
        onKeyDown={(event) => {
          if (isComposing(event)) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            client.dispatch({ type: 'name-commit' });
          } else if (event.key === 'Escape') {
            // The field's own Esc: the name goes back, the panel stays.
            event.preventDefault();
            event.stopPropagation();
            client.dispatch({ type: 'name-revert' });
          }
        }}
      />
      <span class="cg-notes__pen" aria-hidden="true" onClick={() => input.current?.focus()}>
        <Icon name="pencil" size={12} />
      </span>
    </span>
  );
}

/** What the name field is doing, under the head while it is focused or busy. */
function NameStatus({ copy, vm, focused }: { readonly copy: NotesCopy; readonly vm: NotesPanelVM; readonly focused: boolean }): JSX.Element | null {
  const status = vm.name.status;
  if (!focused && status === 'idle') return null;
  return (
    <p class="cg-notes__hint" data-status={status} role={status === 'idle' ? undefined : 'status'}>
      {vm.name.changed !== undefined
        ? vm.name.changed.latest === null
          ? copy.nameRemoved
          : copy.nameChanged.replace('{name}', vm.name.changed.latest)
        : vm.name.error?.code === 'CG-NOTE-WRITE' && vm.name.error.detail === 'changed'
          ? copy.problem.changed
          : copy.name[status]}
    </p>
  );
}

/** «Где показывать»: the view, one for every tab, and the key that opens the notes. */
function ViewMenu({ client, copy, view }: Props & { readonly view: FanslyNotesView }): JSX.Element {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const { deps } = useKit();
  const key = hotkeyText(deps.catalog.entry('notes').hotkey);
  return (
    <MenuAnchor>
      <Button
        variant="quiet"
        size="sm"
        iconOnly
        icon="more"
        label={copy.more}
        haspopup="menu"
        expanded={open}
        buttonRef={button}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (!open) menuTriggerKeys(event, () => setOpen(true));
        }}
      />
      <Menu
        open={open}
        kind="radio"
        label={copy.viewLabel}
        items={FANSLY_NOTES_VIEWS.map((entry) => ({ id: entry, label: copy.views[entry], checked: entry === view }))}
        align="end"
        placement="bottom"
        onSelect={(id) => client.dispatch({ type: 'view', view: id as FanslyNotesView })}
        onClose={() => setOpen(false)}
        returnFocusTo={() => button.current}
        {...(key === null ? {} : { footer: copy.hotkey.replace('{key}', key.display) })}
      />
    </MenuAnchor>
  );
}

function Fact({ copy, fact }: { readonly copy: NotesCopy; readonly fact: NotesFactVM }): JSX.Element {
  return (
    <span class="cg-notes__fact">
      <span class="cg-notes__fact-t">{fact.text}</span>
      {fact.date === null ? null : (
        <span class="cg-notes__fact-date" title={copy.factDate}>
          {fact.date}
        </span>
      )}
    </span>
  );
}

/** A filled field: the whole row opens it in place. */
function FieldRow({ client, copy, part, off }: Props & { readonly part: Extract<NotesFormPartVM, { kind: 'field' }>; readonly off: boolean }): JSX.Element {
  return (
    <button
      type="button"
      class={`cg-notes__frow${part.fresh === true ? ' is-fresh' : ''}${part.current === true ? ' is-current' : ''}${part.seen === true ? ' is-seen' : ''}`}
      data-notes-field={part.label}
      data-flip={`row:${part.label}`}
      title={off ? undefined : copy.fieldHint}
      {...(off ? { 'aria-disabled': 'true' } : {})}
      onClick={() => off || client.dispatch({ type: 'field-open', label: part.label })}
    >
      <span class="cg-notes__label">
        {part.label}
        {part.fresh === true ? (
          <span class="cg-notes__fresh" title={copy.fresh}>
            ✦
          </span>
        ) : null}
      </span>
      <span class="cg-notes__value" {...(part.facts.length > 1 ? { 'data-many': '' } : {})}>
        {part.facts.map((fact, index) => (
          <Fact key={index} copy={copy} fact={fact} />
        ))}
      </span>
      {off ? null : (
        <span class="cg-notes__row-pen" aria-hidden="true">
          <Icon name="pencil" size={12} />
        </span>
      )}
      {part.fresh === true ? (
        <span class="cg-notes__landed" aria-hidden="true">
          ✓
        </span>
      ) : null}
      {/* The Goose answered this field with nothing new: a quiet tick that fades. */}
      {part.seen === true ? (
        <span class="cg-notes__seen" aria-hidden="true">
          ✓
        </span>
      ) : null}
    </button>
  );
}

function problemText(problem: NotesProblem, words: Readonly<Record<'too-long' | 'deleted' | 'changed' | 'failed-create' | 'failed-edit', string>>, errorText: (error: CgAnyErrorWire) => string, empty: string): string {
  if (problem.kind === 'failed') return problem.error.code === 'CG-NOTE-WRITE' && problem.error.detail === 'changed' ? words.changed : `${errorText(problem.error)}. ${words[problem.created ? 'failed-create' : 'failed-edit']}`;
  return problem.kind === 'empty' ? empty : words[problem.kind];
}

/** A field open in place: its facts one per line; Enter writes it to Fansly, Esc puts it away. */
function FieldEditor({ client, copy, field }: Props & { readonly field: NotesFieldVM }): JSX.Element {
  const box = useRef<TextElement | null>(null);
  const errorText = useErrorText();
  useFocusAtEnd(box, field.label);
  const off = field.saving || field.blocked;
  return (
    <div class="cg-notes__fedit" data-notes-field-edit={field.label} data-flip={`row:${field.label}`}>
      <span class="cg-notes__label">{field.label}</span>
      <div class="cg-notes__cell">
        <TextField
          multiline
          minHeight={30}
          maxHeight={200}
          value={field.value}
          label={field.label}
          placeholder={copy.fieldEmpty}
          inputRef={box}
          onValue={(value) => client.dispatch({ type: 'field-input', value })}
          onEnter={() => client.dispatch({ type: 'field-save' })}
          onEscape={() => {
            client.dispatch({ type: 'field-cancel' });
            return true;
          }}
          {...(field.saving ? { reason: copy.saving } : {})}
        />
        <div class="cg-notes__acts">
          <button type="button" class={`cg-act cg-act--main cg-act--sm${field.saving ? ' is-busy' : ''}`} data-notes-field-save="" {...(off ? { 'aria-disabled': 'true' } : {})} onClick={() => off || client.dispatch({ type: 'field-save' })}>
            <span class="cg-act__t">{field.saving ? copy.saving : copy.save}</span>
          </button>
          <Button variant="quiet" size="sm" label={copy.cancel} {...(field.saving ? { reason: copy.saving } : {})} onClick={() => client.dispatch({ type: 'field-cancel' })} />
          <span class="cg-notes__keys">{copy.fieldKeys}</span>
        </div>
        {field.problem === null ? null : (
          <p class="cg-notes__problem" role="alert" data-notes-problem={field.problem.kind}>
            {problemText(field.problem, copy.fieldProblem, errorText, copy.problem.empty)}
          </p>
        )}
      </div>
    </div>
  );
}

type FieldPart = Extract<NotesFormPartVM, { kind: 'field' }>;

/** A suggestion of the Goose: its words in the AI serif on the draft's warm dashed pill. A press or Enter writes it to
 * Fansly, × or Backspace puts it aside; the fan's words show on hover or focus. */
function Pill({ client, copy, sug, words, inline }: Props & { readonly sug: NotesSuggestionVM; readonly words: string; readonly inline: boolean }): JSX.Element {
  const still = useReducedMotion();
  // × fades the pill out first; the suggestion is put aside as it ends (a pill gone meanwhile puts nothing aside).
  const [leaving, setLeaving] = useState(false);
  const fade = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (fade.current !== null) clearTimeout(fade.current);
    },
    [],
  );
  const saving = sug.state === 'saving';
  // The answer is still streaming: the pill stands, nothing to take or put aside yet.
  const arriving = sug.state === 'arriving';
  // A pill that came with the stream came in its own time: no stagger, now or once it can be taken.
  const streamed = useRef(arriving);
  const accept = (): void => {
    if (!saving && !leaving && !arriving) client.dispatch({ type: 'suggestion-accept', index: sug.index });
  };
  const dismiss = (): void => {
    if (saving || leaving || arriving) return;
    if (still) return client.dispatch({ type: 'suggestion-dismiss', index: sug.index });
    setLeaving(true);
    fade.current = setTimeout(() => client.dispatch({ type: 'suggestion-dismiss', index: sug.index }), 200);
  };
  return (
    // `--cg-i`: the pills come in one after another, in the questionnaire's order.
    <span class={`cg-notes__pill${inline ? ' is-inline' : ''}${saving ? ' is-saving' : ''}${leaving ? ' is-leaving' : ''}${arriving ? ' is-arriving' : ''}`} style={`--cg-i: ${String(streamed.current ? 0 : sug.index)}`} data-notes-pill={sug.kind}>
      <button
        type="button"
        class="cg-notes__pill-t"
        aria-label={`${copy.accept}: ${words}`}
        {...(saving || arriving ? { 'aria-disabled': 'true' } : {})}
        onClick={accept}
        onKeyDown={(event) => {
          if (event.key !== 'Backspace' && event.key !== 'Delete') return;
          event.preventDefault();
          dismiss();
        }}
      >
        {sug.kind === 'add' ? (
          <span class="cg-notes__pill-plus" aria-hidden="true">
            +
          </span>
        ) : null}
        {words}
      </button>
      {arriving ? null : saving ? (
        <span class="cg-notes__pill-saving">{copy.saving}</span>
      ) : (
        <>
          <button type="button" class="cg-notes__pill-ok" tabIndex={-1} aria-label={copy.accept} data-notes-accept="" onClick={accept}>
            <Icon name="check" size={12} />
          </button>
          <button type="button" class="cg-notes__pill-no" tabIndex={-1} aria-label={copy.dismiss} data-notes-dismiss="" onClick={dismiss}>
            <Icon name="x" size={12} />
          </button>
        </>
      )}
      <span class="cg-notes__said" role="tooltip">
        <span class="cg-notes__said-h">{sug.quotes.length === 0 ? copy.noQuote : copy.quotes}</span>
        {sug.quotes.slice(0, 2).map((quote, at) => (
          <span key={at} class="cg-notes__said-q">
            «{quote}»
          </span>
        ))}
        {sug.kind === 'replace' && sug.drops.length > 0 ? <span class="cg-notes__said-r">{copy.replaces.replace('{old}', sug.drops.map((fact) => fact.text).join('; '))}</span> : null}
        <span class="cg-notes__said-k">{copy.suggestKeys}</span>
      </span>
    </span>
  );
}

/** A row changed since the Goose read it: what it holds now, and the question «Заменить?». */
function Conflict({ client, copy, sug }: Props & { readonly sug: NotesSuggestionVM }): JSX.Element {
  return (
    <span class="cg-notes__conflict" role="alert" data-notes-conflict="">
      <span class="cg-notes__conflict-t">{copy.conflict.replace('{now}', sug.now ?? '').replace('{value}', sug.value)}</span>
      <span class="cg-notes__conflict-acts">
        <Button variant="line" size="sm" label={copy.replace} onClick={() => client.dispatch({ type: 'suggestion-replace', index: sug.index })} />
        <Button variant="quiet" size="sm" label={copy.keepIt} onClick={() => client.dispatch({ type: 'suggestion-dismiss', index: sug.index })} />
      </span>
    </span>
  );
}

/** A row with the Goose's suggestion: no editor until it is taken or put aside. A refinement stands right after the
 * words it extends, a rewrite strikes what goes, an addition is a new line, an empty field is a faint row. */
function SuggestedRow({ client, copy, part, sug }: Props & { readonly part: FieldPart; readonly sug: NotesSuggestionVM }): JSX.Element {
  const conflict = sug.state === 'conflict';
  const base = sug.kind === 'refine' && !conflict ? part.facts.findIndex((fact) => fact.text === sug.base) : -1;
  const drops = new Set(sug.kind === 'replace' && !conflict ? sug.drops.map((fact) => fact.text) : []);
  // A refinement whose words are no longer there shows the whole value.
  const alone = sug.kind === 'refine' && base === -1 ? sug.value : sug.text === '' ? copy.dropOnly : sug.text;
  const lines = part.facts.length + (base === -1 && !conflict ? 1 : 0);
  return (
    <div class={`cg-notes__frow is-suggested${part.ghost === true ? ' is-ghost' : ''}`} data-notes-field={part.label} data-notes-suggestion={sug.kind} data-flip={`row:${part.label}`}>
      <span class="cg-notes__label">
        {part.label}
        {sug.kind === 'new' ? <span class="cg-notes__newf">✦ {copy.newField}</span> : null}
      </span>
      <span class="cg-notes__value" {...(lines > 1 ? { 'data-many': '' } : {})}>
        {part.facts.map((fact, at) =>
          at === base ? (
            <span key={at} class="cg-notes__fact">
              <span class="cg-notes__fact-t">
                {fact.text}
                <Pill client={client} copy={copy} sug={sug} words={sug.text} inline />
              </span>
              {(sug.date ?? fact.date) === null ? null : <span class="cg-notes__fact-date">{sug.date ?? fact.date}</span>}
            </span>
          ) : (
            <span key={at} class={`cg-notes__fact${drops.has(fact.text) ? ' is-dropped' : ''}`}>
              <span class="cg-notes__fact-t">{fact.text}</span>
              {fact.date === null ? null : <span class="cg-notes__fact-date">{fact.date}</span>}
            </span>
          ),
        )}
        {base === -1 && !conflict ? (
          <span class="cg-notes__fact is-sug">
            <span class="cg-notes__fact-t">
              <Pill client={client} copy={copy} sug={sug} words={alone} inline={false} />
            </span>
            {sug.date === null ? null : <span class="cg-notes__fact-date">{sug.date}</span>}
          </span>
        ) : null}
        {conflict ? <Conflict client={client} copy={copy} sug={sug} /> : null}
      </span>
      <span />
    </div>
  );
}

/** Over the rows while suggestions wait: how many, «Принять все», «Скрыть»; when none waits: what was done. */
function SuggestBar({ client, copy, fill }: Props & { readonly fill: NotesFillVM }): JSX.Element {
  const errorText = useErrorText();
  if (fill.status === 'done') {
    return (
      <div class="cg-notes__done" role="status" data-notes-done="" data-flip="done">
        <Icon name="check" size={13} />
        <span class="cg-notes__done-b">
          <span class="cg-notes__done-t">
            {(fill.created ? copy.doneNew : copy.doneMore).replace('{w}', String(fill.written))}
            {fill.dismissed > 0 ? copy.doneDismissed.replace('{d}', String(fill.dismissed)) : ''}
          </span>
          {fill.unfound.length === 0 ? null : <span class="cg-notes__done-u">{copy.unfound.replace('{labels}', fill.unfound.join(', '))}</span>}
        </span>
        <Button variant="quiet" size="sm" iconOnly icon="x" label={copy.fillClose} onClick={() => client.dispatch({ type: 'fill-close' })} />
      </div>
    );
  }
  return (
    <>
      <div class="cg-notes__sugbar" data-notes-sugbar="" data-flip="bar">
        <span class="cg-notes__sugbar-t">
          <span class="cg-notes__spark" aria-hidden="true">
            ✦
          </span>
          {copy.suggestBar.replace('{n}', String(fill.pending))}
          {fill.written > 0 ? <span class="cg-notes__sugbar-w">{` · ${copy.suggestWritten.replace('{n}', String(fill.written))}`}</span> : null}
        </span>
        <span class="cg-notes__spacer" />
        {fill.pending === 0 ? null : <Button variant="line" size="sm" label={copy.acceptAll} class="cg-notes__ai" {...(fill.blocked ? { reason: copy.fillProblem['failed-create'] } : {})} onClick={() => client.dispatch({ type: 'suggestions-accept-all' })} />}
        <Button variant="quiet" size="sm" label={copy.hideAll} onClick={() => client.dispatch({ type: 'suggestions-dismiss-all' })} />
      </div>
      {fill.problem === null ? null : (
        <p class="cg-notes__problem" role="alert" data-notes-problem={fill.problem.kind}>
          {problemText(fill.problem, copy.fillProblem, errorText, copy.problem.empty)}
        </p>
      )}
      {fill.undoFailed ? (
        <p class="cg-notes__problem" role="alert">
          {copy.undoFailed}
        </p>
      ) : null}
    </>
  );
}

/** «Записано: Локация · Отменить» for a few seconds after a ✓, over the panel's bottom. */
function UndoToast({ client, copy, fill }: Props & { readonly fill: NotesFillVM }): JSX.Element | null {
  const undo = fill.undo;
  if (undo === null) return null;
  return (
    <div class="cg-notes__toast" role="status" data-notes-undo="">
      <span class="cg-notes__toast-t">{undo.labels.length > 2 ? copy.undoMany.replace('{n}', String(undo.labels.length)) : copy.undoLine.replace('{labels}', undo.labels.join(', '))}</span>
      <button type="button" class="cg-notes__toast-b" {...(undo.undoing ? { 'aria-disabled': 'true' } : {})} onClick={() => undo.undoing || client.dispatch({ type: 'suggestion-undo' })}>
        {undo.undoing ? copy.undoing : copy.undo}
      </button>
    </div>
  );
}

/** The fill found nothing, or failed: said once, with «Ещё раз» after a failure. */
function FillNotice({ client, copy, fill }: Props & { readonly fill: NotesFillVM }): JSX.Element {
  const errorText = useErrorText();
  const failed = fill.status === 'failed';
  return (
    <div class={`cg-notes__notice${failed ? ' is-failed' : ''}`} role={failed ? 'alert' : 'status'} data-notes-fill-notice={fill.status}>
      <span class="cg-notes__notice-t">
        {failed ? <Dot kind="danger" /> : null}
        {failed && fill.error !== null ? `${copy.fillFailed}: ${errorText(fill.error)}` : copy.fillNothing}
      </span>
      <span class="cg-notes__notice-acts">
        {failed ? <Button variant="quiet" size="sm" label={copy.fillAgain} {...(fill.reason === null ? {} : { reason: fill.reason === 'editing' ? copy.fillEditing : copy.fillWriting })} onClick={() => client.dispatch({ type: 'fill' })} /> : null}
        <Button variant="quiet" size="sm" label={failed ? copy.fillClose : copy.fillOk} onClick={() => client.dispatch({ type: 'fill-close' })} />
      </span>
    </div>
  );
}

/** Why the fill cannot start now, in the button's tooltip. */
function fillReason(copy: NotesCopy, fill: NotesFillVM): string | null {
  return fill.reason === 'editing' ? copy.fillEditing : fill.reason === 'writing' ? copy.fillWriting : null;
}

/** «сообщение / сообщения / сообщений» by the number (the Russian rule; English takes its first two forms). */
function plural(count: number, forms: readonly [string, string, string]): string {
  const ten = count % 10;
  const hundred = count % 100;
  return ten === 1 && hundred !== 11 ? forms[0] : ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14) ? forms[1] : forms[2];
}

/** What the Goose is doing now, in words: collecting the chat, reading it (how much), checking the questionnaire. */
function ProgressWords({ copy, progress, language }: { readonly copy: NotesCopy; readonly progress: NotesFillProgressVM; readonly language: string }): JSX.Element {
  if (progress.stage === 'gather') return <b>{copy.stageGather}</b>;
  if (progress.stage === 'read') {
    if (progress.read === null) return <b>{copy.stageReadPlain}</b>;
    const count = new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : 'en-US').format(progress.read);
    return (
      <>
        <b>
          {copy.stageRead.replace('{n}', count).replace('{messages}', plural(progress.read, copy.messages))}
          {progress.eta === null ? '…' : ''}
        </b>
        {progress.eta === null ? null : <span class="cg-notes__run-n">{` · ${copy.stageEta.replace('{s}', String(progress.eta))}`}</span>}
      </>
    );
  }
  return (
    <>
      <b>
        {copy.stageCheck}
        {progress.current === null ? '' : `: ${progress.current}`}
      </b>
      <span class="cg-notes__run-n">{` · ${copy.stageOf.replace('{k}', String(progress.checked)).replace('{n}', String(progress.total))}`}</span>
      {progress.found > 0 ? <span class="cg-notes__run-n">{` · ${copy.stageFound.replace('{f}', String(progress.found))}`}</span> : null}
    </>
  );
}

/** While the Goose works: what it does now, the m:ss timer, «Остановить», and a bar (running while it collects and
 * reads, filling as it checks the questionnaire field by field). */
function Running({ client, copy, fill }: Props & { readonly fill: NotesFillVM }): JSX.Element | null {
  const language = useI18n().language;
  const phase = fill.phase;
  if (phase === null) return null;
  const progress = fill.progress;
  // The one retry after a 503 counts down in the kit's stage line.
  if (progress === null || phase.retryAt !== null) {
    return (
      <div class="cg-notes__running" role="status" data-notes-fill-line="" data-flip="run">
        <span class="cg-notes__run-mark" aria-hidden="true">
          ✦
        </span>
        <StageLine phase={phase} startedAt={phase.startedAt} />
        <span class="cg-notes__spacer" />
        <Button variant="quiet" size="sm" label={copy.fillStop} class="cg-notes__stop" onClick={() => client.dispatch({ type: 'fill-stop' })} />
      </div>
    );
  }
  const share = progress.stage === 'check' && progress.total > 0 ? Math.min(1, progress.checked / progress.total) : null;
  return (
    <div class="cg-notes__running has-bar" role="status" data-notes-fill-line="" data-flip="run" data-stage={progress.stage}>
      <span class="cg-notes__run-mark" aria-hidden="true">
        ✦
      </span>
      <span class="cg-notes__run-t">
        <ProgressWords copy={copy} progress={progress} language={language} />
      </span>
      <span class="cg-timer">
        <ElapsedTimer since={phase.startedAt} />
      </span>
      <Button variant="quiet" size="sm" label={copy.fillStop} class="cg-notes__stop" onClick={() => client.dispatch({ type: 'fill-stop' })} />
      {/* Checking: the share of the fields answered. Reading with a known size: it fills at the usual pace of a chat
          this long (most of the way, the rest is the answer). Before that: it runs. */}
      <span class={`cg-notes__run-bar${share === null ? (progress.eta === null ? ' is-busy' : ' is-eta') : ''}`} aria-hidden="true">
        <i style={share !== null ? `width: ${String(Math.round(share * 100))}%` : progress.eta === null ? undefined : `animation-duration: ${String(progress.eta)}s`} />
      </span>
    </div>
  );
}

/** A fan without a questionnaire: the Goose fills it from the chat, the panel's first action. */
function Start({ client, copy, fill, manual, onManual }: Props & { readonly fill: NotesFillVM; readonly manual: boolean; readonly onManual: () => void }): JSX.Element {
  const reason = fillReason(copy, fill);
  return (
    <div class="cg-notes__start" data-notes-start="">
      {fill.status === 'running' ? (
        <Running client={client} copy={copy} fill={fill} />
      ) : (
        <>
          <p class="cg-notes__start-t">{copy.startTitle}</p>
          <p class="cg-notes__start-s">{copy.startText}</p>
          <div class="cg-notes__start-acts">
            <Button variant="line" label={copy.fillNew} tooltip={copy.fillHint} class="cg-notes__ai cg-notes__ai--lg" {...(reason === null ? {} : { reason })} onClick={() => client.dispatch({ type: 'fill' })} />
            {manual ? null : <Button variant="quiet" label={copy.manual} onClick={onManual} />}
          </div>
        </>
      )}
    </div>
  );
}

function Confirm({ client, copy, vm, ask }: Props & { readonly vm: NotesPanelVM; readonly ask: string }): JSX.Element {
  const errorText = useErrorText();
  const deleting = vm.deleting !== null;
  return (
    <div class="cg-notes__confirm" role="alert" data-notes-confirm="">
      <span class="cg-notes__confirm-t">{vm.deleteError === null ? ask : errorText(vm.deleteError)}</span>
      <Button variant="line" size="sm" label={deleting ? copy.removing : copy.remove} busy={deleting} onClick={() => client.dispatch({ type: 'delete' })} />
      <Button variant="quiet" size="sm" label={copy.keep} {...(deleting ? { reason: copy.removing } : {})} onClick={() => client.dispatch({ type: 'keep' })} />
    </div>
  );
}

/** A note open as text: a free note, or the questionnaire («Править текстом»). */
function Editor({ client, copy, editor }: Props & { readonly editor: NotesEditorVM }): JSX.Element {
  const box = useRef<TextElement | null>(null);
  const errorText = useErrorText();
  const key = useSaveKey();
  useFocusAtEnd(box, editor.noteId);
  const problem = editor.problem;
  const off = editor.saving || editor.blocked;
  return (
    <div
      class="cg-notes__edit"
      data-notes-editor={editor.noteId ?? 'new'}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !isComposing(event)) {
          event.preventDefault();
          client.dispatch({ type: 'save' });
        }
      }}
    >
      <TextField value={editor.title} label={copy.titlePlaceholder} placeholder={copy.titlePlaceholder} onValue={(title) => client.dispatch({ type: 'input', title, text: editor.text })} {...(editor.saving ? { reason: copy.saving } : {})} />
      <TextField
        multiline
        minHeight={72}
        maxHeight={320}
        value={editor.text}
        label={copy.textPlaceholder}
        placeholder={copy.textPlaceholder}
        inputRef={box}
        onValue={(value) => client.dispatch({ type: 'input', title: editor.title, text: value })}
        // The box's Esc keeps the draft and the panel: nothing typed goes by a stray key.
        onEscape={() => true}
        {...(editor.saving ? { reason: copy.saving } : {})}
      />
      {problem === null ? null : (
        <p class="cg-notes__problem" role="alert" data-notes-problem={problem.kind}>
          {problemText(problem, copy.problem, errorText, copy.problem.empty)}
        </p>
      )}
      {/* Changed elsewhere (audit №13): what Fansly holds now, to compare before «Сохранить» writes the draft over it. */}
      {problem?.kind === 'changed' ? (
        <div class="cg-notes__latest" data-notes-latest="">
          <span class="cg-notes__latest-h">{copy.latest}</span>
          {problem.latest.title === '' ? null : <span class="cg-notes__item-title">{problem.latest.title}</span>}
          {problem.latest.text === '' ? null : <p class="cg-notes__item-text">{problem.latest.text}</p>}
        </div>
      ) : null}
      <div class="cg-notes__acts">
        <button type="button" class={`cg-act cg-act--main cg-act--sm${editor.saving ? ' is-busy' : ''}`} title={copy.saveHint} data-notes-save="" {...(off ? { 'aria-disabled': 'true' } : {})} onClick={() => off || client.dispatch({ type: 'save' })}>
          <span class="cg-act__t">{editor.saving ? copy.saving : copy.save}</span>
        </button>
        <Button variant="quiet" size="sm" label={copy.cancel} {...(editor.saving ? { reason: copy.saving } : {})} onClick={() => client.dispatch({ type: 'cancel' })} />
        <span class="cg-notes__keys">{copy.editKeys.replace('{key}', key)}</span>
      </div>
    </div>
  );
}

/** «Анкета»: the table, a field open in place, «+ Метка»; the fill, its draft in the same table. A fan without one: the
 * card that fills it from the chat. */
function FormSection({ client, copy, vm, form }: Props & { readonly vm: NotesPanelVM; readonly form: NotesFormVM }): JSX.Element {
  const [manual, setManual] = useState(false);
  const section = useRef<HTMLElement | null>(null);
  useFlip(section, useReducedMotion());
  const fill = form.fill;
  const asText = vm.editor !== null && form.noteId !== null && vm.editor.noteId === form.noteId;
  const status = fill?.status ?? 'idle';
  const running = status === 'running';
  const field = form.field;
  // A row opens nothing while the Goose reads, while the questionnaire is open as text or a write of the fan is in flight.
  const off = form.locked || running || vm.writing || (field !== null && field.saving);
  const asked = form.noteId !== null && vm.confirmDelete === form.noteId;
  const blank = form.blank.filter((label) => !(field?.blank === true && field.label === label));
  // No questionnaire yet: the card with «✨ Заполнить из чата» stands first; the fields wait behind «Заполнить вручную».
  const start = form.noteId === null && fill !== null && status !== 'review' && status !== 'done';
  const reviewing = status === 'review';
  // While the Goose fills a new one, the fields wait for it.
  const chips = !start || field !== null || (manual && !running);
  const reason = fill === null ? null : fillReason(copy, fill);
  return (
    <section
      ref={section}
      class="cg-notes__sec cg-notes__form"
      data-notes-form={form.noteId ?? 'none'}
      aria-label={copy.form}
      {...(running ? { 'data-busy': '', 'data-fill-stage': fill?.progress?.stage ?? 'gather' } : {})}
    >
      <div class="cg-notes__sec-head">
        <h3 class="cg-notes__sec-t">{form.title === '' ? copy.form : form.title}</h3>
        {form.locked ? (
          <span class="cg-notes__tag" title={copy.lockedHint}>
            <Icon name="lock" size={12} />
            {copy.locked}
          </span>
        ) : null}
        <span class="cg-notes__spacer" />
        {asText || start || fill === null || running || reviewing ? null : (
          <Button variant="line" size="sm" label={copy.fill} tooltip={copy.fillHint} class="cg-notes__ai" {...(reason === null ? {} : { reason })} onClick={() => client.dispatch({ type: 'fill' })} />
        )}
      </div>
      {asText && vm.editor !== null ? (
        <Editor client={client} copy={copy} editor={vm.editor} />
      ) : (
        <>
          {fill !== null && (status === 'review' || status === 'done') ? <SuggestBar client={client} copy={copy} fill={fill} /> : null}
          {fill !== null && (status === 'empty' || status === 'failed') ? <FillNotice client={client} copy={copy} fill={fill} /> : null}
          {start && fill !== null ? <Start client={client} copy={copy} fill={fill} manual={chips} onManual={() => setManual(true)} /> : null}
          {running && !start && fill !== null ? <Running client={client} copy={copy} fill={fill} /> : null}
          {form.noteId === null && fill === null && field === null ? <p class="cg-notes__none">{copy.formNoneManual}</p> : null}
          {form.parts.length === 0 ? null : (
            <div class="cg-notes__table" data-notes-table="">
              {/* While the Goose reads: a warm band sweeps down the questionnaire. */}
              {running && fill?.progress?.stage !== 'check' ? <span class="cg-notes__scan" aria-hidden="true" /> : null}
              {form.parts.map((part, at) =>
                part.kind === 'text' ? (
                  <div key={`t${String(at)}`} class="cg-notes__free" data-flip={`text:${String(at)}`}>
                    {part.text}
                  </div>
                ) : part.suggestion !== undefined ? (
                  <SuggestedRow key={`f${part.label}`} client={client} copy={copy} part={part} sug={part.suggestion} />
                ) : field !== null && !field.blank && field.label === part.label ? (
                  <FieldEditor key={`f${part.label}`} client={client} copy={copy} field={field} />
                ) : (
                  <FieldRow key={`f${part.label}`} client={client} copy={copy} part={part} off={off} />
                ),
              )}
            </div>
          )}
          {field !== null && field.blank ? <FieldEditor client={client} copy={copy} field={field} /> : null}
          {blank.length === 0 || form.locked || !chips ? null : (
            <div class="cg-notes__blank" data-notes-blank="">
              {blank.map((label) => (
                <button
                  key={label}
                  type="button"
                  class={`cg-notes__chip${fill?.progress?.current === label ? ' is-current' : ''}`}
                  data-notes-add={label}
                  data-flip={`chip:${label}`}
                  {...(off ? { 'aria-disabled': 'true' } : {})} onClick={() => off || client.dispatch({ type: 'field-open', label })}>
                  <span aria-hidden="true">+</span>
                  {label}
                </button>
              ))}
            </div>
          )}
          {form.unplaced.length === 0 ? null : <p class="cg-notes__unplaced">{copy.unplaced.replace('{labels}', form.unplaced.join(', '))}</p>}
          {asked ? <Confirm client={client} copy={copy} vm={vm} ask={copy.removeFormAsk} /> : null}
          {form.noteId === null || form.locked || running || reviewing || field !== null || asked || vm.editor !== null ? null : (
            <div class="cg-notes__form-acts" data-flip="acts">
              <Button variant="quiet" size="sm" label={copy.asText} onClick={() => client.dispatch({ type: 'edit', noteId: form.noteId as string })} />
              <Button variant="quiet" size="sm" label={copy.removeForm} onClick={() => client.dispatch({ type: 'ask-delete', noteId: form.noteId as string })} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** The box at the top of the notes: a line typed and Enter makes it a note. */
function QuickBox({ client, copy, quick }: Props & { readonly quick: NotesQuickVM }): JSX.Element {
  const errorText = useErrorText();
  const typed = quick.text.trim() !== '';
  const off = quick.saving || quick.blocked;
  const problem = quick.problem;
  return (
    <div class={`cg-notes__quick${typed ? ' is-typed' : ''}`} data-notes-quick="">
      <TextField
        multiline
        minHeight={32}
        maxHeight={160}
        value={quick.text}
        label={copy.quickPlaceholder}
        placeholder={copy.quickPlaceholder}
        onValue={(text) => client.dispatch({ type: 'quick-input', text })}
        onEnter={() => client.dispatch({ type: 'quick-save' })}
        // Esc in a box with text keeps it: nothing typed goes by a stray key. An empty box lets the panel close.
        onEscape={() => typed}
        {...(quick.saving ? { reason: copy.saving } : {})}
      />
      {typed || quick.saving ? (
        <div class="cg-notes__acts">
          <button type="button" class={`cg-act cg-act--main cg-act--sm${quick.saving ? ' is-busy' : ''}`} data-notes-quick-save="" {...(off ? { 'aria-disabled': 'true' } : {})} onClick={() => off || client.dispatch({ type: 'quick-save' })}>
            <span class="cg-act__t">{quick.saving ? copy.saving : copy.save}</span>
          </button>
          <span class="cg-notes__keys">{copy.quickKeys}</span>
        </div>
      ) : null}
      {problem === null ? null : (
        <p class="cg-notes__problem" role="alert" data-notes-problem={problem.kind}>
          {problem.kind === 'failed' ? `${errorText(problem.error)}. ${copy.quickProblem['failed-create']}` : problem.kind === 'too-long' ? copy.quickProblem['too-long'] : copy.problem.empty}
        </p>
      )}
    </div>
  );
}

/** When a note was created, at its left: «16.10», the full time on hover (decision 171). */
function NoteDate({ copy, date }: { readonly copy: NotesCopy; readonly date: NotesDateVM }): JSX.Element {
  return (
    <time class="cg-notes__date" dateTime={date.iso} title={`${copy.created} ${date.full} ${copy.createdAt} ${date.time}`} data-notes-date="">
      {date.day}
    </time>
  );
}

function NoteItem({ client, copy, vm, item }: Props & { readonly vm: NotesPanelVM; readonly item: NotesItemVM }): JSX.Element {
  const asked = vm.confirmDelete === item.noteId;
  const locked = item.foreign || item.cut;
  return (
    <li class={`cg-notes__item${item.foreign ? ' is-foreign' : ''}${item.cut ? ' is-cut' : ''}`} data-note-id={item.noteId} {...(item.foreign ? { 'data-foreign': 'true' } : {})} {...(item.cut ? { 'data-cut': 'true' } : {})}>
      <span class="cg-notes__item-when">{item.date === null ? null : <NoteDate copy={copy} date={item.date} />}</span>
      <div class="cg-notes__item-b">
        {item.title === '' && !locked ? null : (
          <div class="cg-notes__item-head">
            {item.title === '' ? null : <span class="cg-notes__item-title">{item.title}</span>}
            {item.foreign ? (
              <span class="cg-notes__tag" title={copy.foreignHint}>
                <Icon name="lock" size={12} />
                {copy.foreign}
              </span>
            ) : item.cut ? (
              // Longer than the panel holds (audit №13): shown cut, edited and deleted in Fansly's own window only.
              <span class="cg-notes__tag" title={copy.cutHint}>
                <Icon name="lock" size={12} />
                {copy.cut}
              </span>
            ) : null}
          </div>
        )}
        {item.text === '' ? null : <p class="cg-notes__item-text">{item.text}</p>}
        {item.cut ? (
          <p class="cg-notes__hint" data-notes-cut="">
            {copy.cutHint}
          </p>
        ) : null}
        {asked ? <Confirm client={client} copy={copy} vm={vm} ask={copy.removeAsk} /> : null}
      </div>
      {locked || asked || vm.editor !== null ? null : (
        <span class="cg-notes__item-acts">
          <Button variant="quiet" size="sm" iconOnly icon="pencil" label={copy.edit} onClick={() => client.dispatch({ type: 'edit', noteId: item.noteId })} />
          <Button variant="quiet" size="sm" iconOnly icon="trash" label={copy.remove} onClick={() => client.dispatch({ type: 'ask-delete', noteId: item.noteId })} />
        </span>
      )}
    </li>
  );
}

/** «Заметки»: the box, then the notes, newest first. */
function NotesSection({ client, copy, vm }: Props & { readonly vm: NotesPanelVM }): JSX.Element {
  const editor = vm.editor;
  const form = vm.form;
  // A note deleted elsewhere while open (its draft now makes a new one) stands first.
  const loose = editor !== null && (editor.noteId === null || !vm.items.some((item) => item.noteId === editor.noteId)) && (form === null || editor.noteId !== form.noteId) ? editor : null;
  return (
    <section class="cg-notes__sec cg-notes__notes" aria-label={copy.notes}>
      <div class="cg-notes__sec-head">
        <h3 class="cg-notes__sec-t">{copy.notes}</h3>
        {vm.items.length === 0 ? null : <span class="cg-notes__count">{vm.items.length}</span>}
      </div>
      <QuickBox client={client} copy={copy} quick={vm.quick} />
      {loose === null ? null : <Editor client={client} copy={copy} editor={loose} />}
      {vm.items.length === 0 ? null : (
        <ul class="cg-notes__list">
          {vm.items.map((item) =>
            editor !== null && editor.noteId === item.noteId ? (
              <li key={item.noteId} class="cg-notes__item is-editing" data-note-id={item.noteId}>
                <Editor client={client} copy={copy} editor={editor} />
              </li>
            ) : (
              <NoteItem key={item.noteId} client={client} copy={copy} vm={vm} item={item} />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function Body({ client, copy, vm }: Props & { readonly vm: NotesPanelVM }): JSX.Element {
  const errorText = useErrorText();
  if (vm.body === 'loading') return <p class="cg-notes__empty">{copy.loading}</p>;
  if (vm.body === 'error' && vm.error !== null) {
    return (
      <div class="cg-notes__error" role="alert">
        <span class="cg-notes__error-t">
          <Dot kind="danger" />
          {errorText(vm.error)}
        </span>
        <Button variant="line" size="sm" label={copy.retry} onClick={() => client.dispatch({ type: 'refresh' })} />
      </div>
    );
  }
  return (
    <>
      {/* Keyed by the fan: «Заполнить вручную» opened for one fan is not open for the next. */}
      {vm.form === null ? null : <FormSection key={`${vm.fan?.handle ?? ''}|${vm.form.noteId ?? ''}`} client={client} copy={copy} vm={vm} form={vm.form} />}
      <NotesSection client={client} copy={copy} vm={vm} />
    </>
  );
}

export function NotesPanel({ client, texts }: { readonly client: NotesClient; readonly texts: NotesTexts }): JSX.Element | null {
  useNotesTick(client);
  const language = useI18n().language;
  const copy = texts[language];
  const vm = client.panel();
  const card = useRef<HTMLElement | null>(null);
  const [naming, setNaming] = useState(false);
  const center = vm.view === 'center';
  // The centred window takes the focus as it opens; the side panel leaves it where the person works.
  useEffect(() => {
    if (vm.shown && center) card.current?.focus({ preventScroll: true });
  }, [vm.shown, center]);
  if (!vm.shown) return null;
  const closable = !center ? vm.view !== 'docked' || vm.narrow : true;
  const place = vm.place;
  const busy = vm.body === 'loading' || vm.writing;
  const sub = [vm.name.value !== '' && vm.fan?.name !== null && vm.fan?.name !== undefined ? vm.fan.name : null, vm.fan?.handle === null || vm.fan?.handle === undefined ? null : `@${vm.fan.handle}`].filter((part): part is string => part !== null);
  const panel = (
    <section
      ref={card}
      class={`cg-notes${center ? ' is-center' : ''}`}
      role={center ? 'dialog' : 'complementary'}
      aria-label={copy.title}
      // The words break by syllables, not mid-letter, in the narrow side panel.
      lang={language}
      tabIndex={-1}
      data-notes-view={vm.view}
      data-notes-place={place?.kind ?? 'center'}
      data-notes-body={vm.body}
      {...(center ? { 'aria-modal': 'true' } : {})}
      {...(place === null ? {} : { style: { left: `${place.left}px`, top: `${place.top}px`, bottom: `${place.bottom}px`, width: `${place.width}px` } })}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || isComposing(event) || !closable) return;
        event.preventDefault();
        event.stopPropagation();
        client.dispatch({ type: 'close' });
      }}
    >
      <header class="cg-notes__head">
        <div class="cg-notes__row">
          <div class="cg-notes__who">
            {vm.body === 'ready' ? <NameField client={client} copy={copy} vm={vm} onFocused={setNaming} /> : <span class="cg-notes__name is-static">{vm.fan?.name ?? copy.fan}</span>}
            {sub.length === 0 ? null : <span class="cg-notes__handle">{sub.join(' · ')}</span>}
          </div>
          <Button variant="quiet" size="sm" iconOnly icon="refresh" label={copy.refresh} tooltip={copy.refreshHint} {...(busy ? { busy: true } : {})} onClick={() => client.dispatch({ type: 'refresh' })} />
          <ViewMenu client={client} copy={copy} view={vm.view} />
          {closable ? <Button variant="quiet" size="sm" iconOnly icon="x" label={copy.close} onClick={() => client.dispatch({ type: 'close' })} /> : null}
        </div>
        {vm.body === 'ready' ? <NameStatus copy={copy} vm={vm} focused={naming} /> : null}
      </header>
      <div class="cg-notes__body">
        <Body client={client} copy={copy} vm={vm} />
      </div>
      {vm.form?.fill === null || vm.form?.fill === undefined ? null : <UndoToast client={client} copy={copy} fill={vm.form.fill} />}
      {vm.narrow ? <p class="cg-notes__note-foot">{copy.narrow}</p> : null}
    </section>
  );
  return center ? (
    <>
      <div class="cg-notes-scrim" aria-hidden="true" onClick={() => client.dispatch({ type: 'close' })} />
      {panel}
    </>
  ) : (
    panel
  );
}
