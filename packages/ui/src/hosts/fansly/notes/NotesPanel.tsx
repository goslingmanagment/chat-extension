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
//   the Goose's draft in the same table: what it adds in its serif on a warm row, what a rewrite drops struck, ✕ on each
//   of its rows, the fan's words on hover, and one «Сохранить анкету». The fields it wrote are marked ✦.
// - «Заметки»: a box at the top (a line typed and Enter makes a note), then the notes, newest first, the date at the
//   left; «Изменить» and «Удалить» on a note under the pointer. FBuddy's note and a long one are read only.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { I18nKey } from '@cg/contracts/errors';
import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import { cgTitleKey } from '@cg/contracts/i18n/keys';
import type { NotesClient, NotesCopy, NotesDateVM, NotesDraftFactVM, NotesDraftRowVM, NotesEditorVM, NotesFactVM, NotesFieldVM, NotesFillVM, NotesFormPartVM, NotesFormVM, NotesItemVM, NotesPanelVM, NotesProblem, NotesQuickVM } from '@cg/contracts/notes-fansly';
import { FANSLY_NOTES_VIEWS, type FanslyNotesView } from '@cg/contracts/settings-ext';

import { Button, Dot, Icon, Menu, MenuAnchor, StageLine, TextField, hotkeyText, isComposing, menuTriggerKeys, useI18n, useKit } from '../../../kit';
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
      class={`cg-notes__frow${part.fresh === true ? ' is-fresh' : ''}`}
      data-notes-field={part.label}
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
    <div class="cg-notes__fedit" data-notes-field-edit={field.label}>
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

/** A fact of the Goose's draft: what stays plain, the Goose's own in its serif (the fan's words on hover), what goes
 * struck. */
function DraftFact({ copy, fact, quotes }: { readonly copy: NotesCopy; readonly fact: NotesDraftFactVM; readonly quotes: readonly string[] }): JSX.Element {
  const said = fact.mark === 'added' && quotes.length > 0 ? `${copy.quotes}: ${quotes.map((quote) => `«${quote}»`).join(' ')}` : null;
  return (
    <span class={`cg-notes__fact is-${fact.mark}`} {...(said === null ? {} : { title: said })}>
      <span class="cg-notes__fact-t">{fact.text}</span>
      {fact.date === null ? null : <span class="cg-notes__fact-date">{fact.date}</span>}
    </span>
  );
}

/** A row of the draft: a field the Goose wrote into is warm and has ✕ (put it aside); put aside, «Вернуть». */
function DraftRow({ client, copy, row, saving }: Props & { readonly row: Extract<NotesDraftRowVM, { kind: 'field' }>; readonly saving: boolean }): JSX.Element {
  const index = row.finding;
  const reason = saving ? { reason: copy.saving } : {};
  return (
    <div
      class={`cg-notes__drow${index === null ? '' : row.checked ? ' is-found' : ' is-off'}${row.added ? ' is-added' : ''}`}
      data-notes-draft-row={row.label}
      {...(index === null ? {} : { 'data-checked': row.checked ? 'true' : 'false' })}
    >
      <span class="cg-notes__label">{row.label}</span>
      <span class="cg-notes__value" {...(row.facts.length > 1 ? { 'data-many': '' } : {})}>
        {row.facts.map((fact, at) => (
          <DraftFact key={at} copy={copy} fact={fact} quotes={row.quotes} />
        ))}
      </span>
      <span class="cg-notes__drow-act">
        {index === null ? null : row.checked ? (
          <Button variant="quiet" size="sm" iconOnly icon="x" label={copy.drop} {...reason} onClick={() => client.dispatch({ type: 'finding', index, checked: false })} />
        ) : (
          <Button variant="quiet" size="sm" label={copy.restore} {...reason} onClick={() => client.dispatch({ type: 'finding', index, checked: true })} />
        )}
      </span>
    </div>
  );
}

/** The Goose's draft in the questionnaire's own table; one «Сохранить анкету» writes it, «Отмена» drops it. */
function Draft({ client, copy, form, fill }: Props & { readonly form: NotesFormVM; readonly fill: NotesFillVM }): JSX.Element {
  const errorText = useErrorText();
  const off = fill.saving || fill.blocked;
  return (
    <div class="cg-notes__draft" data-notes-draft="">
      <p class="cg-notes__draft-t">
        <span aria-hidden="true">✨</span>
        {form.noteId === null ? copy.draftNew : copy.draftMore}
      </p>
      <div class="cg-notes__table" data-notes-table="">
        {fill.rows.map((row, at) =>
          row.kind === 'text' ? (
            <div key={`t${String(at)}`} class="cg-notes__free">
              {row.text}
            </div>
          ) : (
            <DraftRow key={`f${row.label}`} client={client} copy={copy} row={row} saving={fill.saving} />
          ),
        )}
      </div>
      {fill.unfound.length === 0 ? null : <p class="cg-notes__unfound">{copy.unfound.replace('{labels}', fill.unfound.join(', '))}</p>}
      {fill.problem === null ? null : (
        <p class="cg-notes__problem" role="alert" data-notes-problem={fill.problem.kind}>
          {problemText(fill.problem, copy.fillProblem, errorText, copy.problem.empty)}
        </p>
      )}
      <div class="cg-notes__acts cg-notes__review-acts">
        <button type="button" class={`cg-act cg-act--main${fill.saving ? ' is-busy' : ''}`} data-notes-apply="" title={copy.saveHint} {...(off ? { 'aria-disabled': 'true' } : {})} onClick={() => off || client.dispatch({ type: 'fill-apply' })}>
          <span class="cg-act__t">{fill.saving ? copy.saving : copy.fillApply}</span>
        </button>
        <Button variant="plain" label={copy.cancel} {...(fill.saving ? { reason: copy.saving } : {})} onClick={() => client.dispatch({ type: 'fill-close' })} />
      </div>
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

/** While the hub reads the chat: its stage and timer, and «Остановить». */
function Running({ client, copy, fill }: Props & { readonly fill: NotesFillVM }): JSX.Element | null {
  if (fill.phase === null) return null;
  return (
    <div class="cg-notes__running" role="status" data-notes-fill-line="">
      <StageLine phase={fill.phase} startedAt={fill.phase.startedAt} />
      <span class="cg-notes__spacer" />
      <Button variant="quiet" size="sm" label={copy.fillStop} class="cg-notes__stop" onClick={() => client.dispatch({ type: 'fill-stop' })} />
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
  const start = form.noteId === null && fill !== null && status !== 'review';
  // While the Goose fills a new one, the fields wait for it.
  const chips = !start || field !== null || (manual && !running);
  const reason = fill === null ? null : fillReason(copy, fill);
  return (
    <section class="cg-notes__sec cg-notes__form" data-notes-form={form.noteId ?? 'none'} aria-label={copy.form} {...(running ? { 'data-busy': '' } : {})}>
      <div class="cg-notes__sec-head">
        <h3 class="cg-notes__sec-t">{form.title === '' ? copy.form : form.title}</h3>
        {form.locked ? (
          <span class="cg-notes__tag" title={copy.lockedHint}>
            <Icon name="lock" size={12} />
            {copy.locked}
          </span>
        ) : null}
        <span class="cg-notes__spacer" />
        {asText || start || fill === null || running || status === 'review' ? null : (
          <Button variant="line" size="sm" label={copy.fill} tooltip={copy.fillHint} class="cg-notes__ai" {...(reason === null ? {} : { reason })} onClick={() => client.dispatch({ type: 'fill' })} />
        )}
      </div>
      {asText && vm.editor !== null ? (
        <Editor client={client} copy={copy} editor={vm.editor} />
      ) : status === 'review' && fill !== null ? (
        <Draft client={client} copy={copy} form={form} fill={fill} />
      ) : (
        <>
          {fill !== null && (status === 'empty' || status === 'failed') ? <FillNotice client={client} copy={copy} fill={fill} /> : null}
          {start && fill !== null ? <Start client={client} copy={copy} fill={fill} manual={chips} onManual={() => setManual(true)} /> : null}
          {running && !start && fill !== null ? <Running client={client} copy={copy} fill={fill} /> : null}
          {form.noteId === null && fill === null && field === null ? <p class="cg-notes__none">{copy.formNoneManual}</p> : null}
          {form.parts.length === 0 ? null : (
            <div class="cg-notes__table" data-notes-table="">
              {form.parts.map((part, at) =>
                part.kind === 'text' ? (
                  <div key={`t${String(at)}`} class="cg-notes__free">
                    {part.text}
                  </div>
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
                <button key={label} type="button" class="cg-notes__chip" data-notes-add={label} {...(off ? { 'aria-disabled': 'true' } : {})} onClick={() => off || client.dispatch({ type: 'field-open', label })}>
                  <span aria-hidden="true">+</span>
                  {label}
                </button>
              ))}
            </div>
          )}
          {form.unplaced.length === 0 ? null : <p class="cg-notes__unplaced">{copy.unplaced.replace('{labels}', form.unplaced.join(', '))}</p>}
          {asked ? <Confirm client={client} copy={copy} vm={vm} ask={copy.removeFormAsk} /> : null}
          {form.noteId === null || form.locked || running || field !== null || asked || vm.editor !== null ? null : (
            <div class="cg-notes__form-acts">
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
  const copy = texts[useI18n().language];
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
