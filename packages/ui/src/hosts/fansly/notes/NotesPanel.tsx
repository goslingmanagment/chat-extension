// The «Заметки» panel of a Fansly tab (R20 P11b; FS-NOTE-2…5; FX-006…FX-013; the Fansly extension's notes-panel.ts):
// the fan's native Fansly notes — the name for oneself in the head (Enter or leaving the field saves a changed name,
// Esc reverts it, an empty one deletes it), the regular notes as a flat list (edit, delete after a confirmation),
// «+ Заметка» and «+ Анкета», and where the panel stands. FBuddy's «FBuddy Notes» is shown with a mark and no
// action: someone else's. Its model is the panel's own client (contracts notes-fansly.ts); nothing here reads the
// page or the network.
//
// A questionnaire (R20 P11b2; the Fansly extension 2.12.0, decision 166) reads as a table — the label, its facts one per line,
// the month a fact was said at the right, the empty fields folded into one line — and is edited field by field, one
// fact per line; «Текстом» / «Полями» switch to the note's one text and back. The Goose's rewrite of a field stands
// under that field with «Принять» and «Не нужно».
//
// «✨ Заполнить из чата» (R20 P11c, FS-NOTE-6) stands at the foot of a questionnaire being edited, where the page's
// owner switched it on: while the hub reads the chat it is «Остановить» and «Сохранить» waits; then a line says which
// fields the Goose wrote into and how many additions wait under the filled ones.

import type { JSX, Ref } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { I18nKey } from '@cg/contracts/errors';
import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import { cgTitleKey } from '@cg/contracts/i18n/keys';
import type { NotesClient, NotesCopy, NotesEditorVM, NotesFillVM, NotesFormPartVM, NotesPanelVM, NotesSuggestionVM } from '@cg/contracts/notes-fansly';
import { FANSLY_NOTES_VIEWS, type FanslyNotesView } from '@cg/contracts/settings-ext';
import type { FanslyNote } from '@cg/contracts/tab-messages-fansly';

import { Button, Dot, Icon, TextField, hotkeyText, isComposing, useI18n, useKit } from '../../../kit';
import { useNotesTick, type NotesTexts } from './NotesButton';

type Props = { readonly client: NotesClient; readonly copy: NotesCopy };

function useErrorText(): (error: CgAnyErrorWire) => string {
  const i18n = useI18n();
  return (error) => `${i18n.t(cgTitleKey(error.code) as I18nKey)} · ${error.code}`;
}

function NameField({ client, copy, vm }: Props & { readonly vm: NotesPanelVM }): JSX.Element {
  const [focused, setFocused] = useState(false);
  const status = vm.name.status;
  const locked = status === 'saving' || status === 'unconfirmed';
  return (
    <>
      <input
        class="cg-notes__name"
        type="text"
        value={vm.name.value}
        placeholder={vm.fan?.name ?? copy.namePlaceholder}
        aria-label={copy.namePlaceholder}
        title={copy.name.idle}
        data-notes-name=""
        size={Math.max(8, Math.min(40, (vm.name.value || vm.fan?.name || copy.namePlaceholder).length + 1))}
        {...(locked ? { readOnly: true, 'aria-busy': 'true' } : {})}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
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
      {focused || status !== 'idle' ? (
        <p class="cg-notes__hint" data-status={status} role={status === 'idle' ? undefined : 'status'}>
          {vm.name.error?.code === 'CG-NOTE-WRITE' && vm.name.error.detail === 'changed' ? copy.problem.changed : copy.name[status]}
        </p>
      ) : null}
    </>
  );
}

type FieldPart = Extract<NotesFormPartVM, { readonly kind: 'field' }>;

/** A questionnaire to read: the label, its facts one per line, the month a fact was said at the right. */
function FormView({ copy, form }: { readonly copy: NotesCopy; readonly form: readonly NotesFormPartVM[] }): JSX.Element {
  const blank = form.filter((part): part is FieldPart => part.kind === 'field' && part.facts.length === 0).map((part) => part.label);
  return (
    <div class="cg-notes__form" data-notes-form="">
      <dl class="cg-notes__fields">
        {form.map((part, at) =>
          part.kind === 'text' ? (
            <div key={`t${String(at)}`} class="cg-notes__free">
              {part.text}
            </div>
          ) : part.facts.length === 0 ? null : (
            <div key={`f${part.label}`} class="cg-notes__pair" data-notes-field={part.label}>
              <dt class="cg-notes__label">{part.label}</dt>
              <dd class="cg-notes__value" {...(part.facts.length > 1 ? { 'data-many': '' } : {})}>
                {part.facts.map((fact, index) => (
                  <span key={index} class="cg-notes__fact">
                    <span class="cg-notes__fact-t">{fact.text}</span>
                    {fact.date === null ? null : (
                      <span class="cg-notes__fact-date" title={copy.factDate}>
                        {fact.date}
                      </span>
                    )}
                  </span>
                ))}
              </dd>
            </div>
          ),
        )}
      </dl>
      {blank.length === 0 ? null : <p class="cg-notes__blank">{`${copy.blank}: ${blank.join(', ')}`}</p>}
    </div>
  );
}

/** The Goose's rewrite of a field: what it adds and drops, the fan's words behind it, «Принять» and «Не нужно». */
function Suggestion({ client, copy, suggestion, named, saving }: Props & { readonly suggestion: NotesSuggestionVM; readonly named: boolean; readonly saving: boolean }): JSX.Element {
  // A rewrite that only reorders or respaces has no fact to single out: shown whole.
  const whole = suggestion.added.length === 0 && suggestion.removed.length === 0;
  const title = whole || suggestion.removed.length > 0 ? copy.suggestReplace : copy.suggestAdd;
  return (
    <div class="cg-notes__suggest" data-notes-suggestion={suggestion.index}>
      <div class="cg-notes__suggest-head">
        <span class="cg-notes__suggest-t">{named ? `${title} ${copy.suggestIn} «${suggestion.label}»` : title}</span>
        <Button variant="quiet" size="sm" label={copy.accept} {...(saving ? { reason: copy.saving } : {})} onClick={() => client.dispatch({ type: 'suggestion', index: suggestion.index, accept: true })} />
        <Button variant="quiet" size="sm" iconOnly icon="x" label={copy.dismiss} onClick={() => client.dispatch({ type: 'suggestion', index: suggestion.index, accept: false })} />
      </div>
      <div class="cg-notes__suggest-facts">
        {suggestion.removed.map((fact) => (
          <del key={`-${fact}`} class="cg-notes__fact-del">
            {fact}
          </del>
        ))}
        {(whole ? [suggestion.proposed] : suggestion.added).map((fact) => (
          <ins key={`+${fact}`} class="cg-notes__fact-add">
            {fact}
          </ins>
        ))}
      </div>
      {suggestion.quotes.length === 0 ? null : (
        <ul class="cg-notes__quotes">
          {suggestion.quotes.map((quote) => (
            <li key={quote}>«{quote}»</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A field's facts as the note keeps them: one per line in the box, «; » in the note. */
const factsOf = (value: string): string =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('; ')
    .replace(/;\s+/g, '; ');

/** A field's box: one fact per line. What the person typed stays as typed (a new empty line, a trailing space) while
 * the note holds the same facts; a change from elsewhere (a rewrite accepted, the text edited) replaces it. */
function FieldRow({ client, copy, part, saving, inputRef }: Props & { readonly part: FieldPart; readonly saving: boolean; readonly inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement> }): JSX.Element {
  const typed = useRef<string | null>(null);
  const value = typed.current !== null && factsOf(typed.current) === factsOf(part.value) ? typed.current : part.value;
  return (
    <div class="cg-notes__frow" data-notes-field={part.label}>
      <span class="cg-notes__label">{part.label}</span>
      <div class="cg-notes__cell">
        <TextField
          multiline
          minHeight={28}
          maxHeight={200}
          value={value}
          label={part.label}
          {...(inputRef === undefined ? {} : { inputRef })}
          onValue={(next) => {
            typed.current = next;
            client.dispatch({ type: 'field', label: part.label, value: next });
          }}
          onEscape={() => true}
          {...(saving ? { reason: copy.saving } : {})}
        />
        {part.suggestions.map((suggestion) => (
          <Suggestion key={suggestion.index} client={client} copy={copy} suggestion={suggestion} named={false} saving={saving} />
        ))}
      </div>
    </div>
  );
}

/** What the fill is doing or did, in a line: «Гусь вписал: Возраст, Хобби. Добавки под полями: 2.» */
function FillLine({ copy, fill, offered }: { readonly copy: NotesCopy; readonly fill: NotesFillVM; readonly offered: number }): JSX.Element | null {
  const errorText = useErrorText();
  if (fill.status === 'idle') return null;
  const text =
    fill.status === 'running'
      ? copy.filling
      : fill.status === 'failed' && fill.error !== null
        ? `${copy.fillFailed}: ${errorText(fill.error)}`
        : fill.wrote.length === 0 && offered === 0
          ? copy.fillNothing
          : [fill.wrote.length === 0 ? '' : `${copy.fillWrote} ${fill.wrote.join(', ')}.`, offered === 0 ? '' : `${copy.fillOffers} ${String(offered)}.`].filter(Boolean).join(' ');
  return (
    <p class={`cg-notes__fill is-${fill.status}`} role={fill.status === 'failed' ? 'alert' : 'status'} data-notes-fill-line="">
      {fill.status === 'running' ? <Dot kind="pulse" /> : fill.status === 'failed' ? <Dot kind="danger" /> : null}
      {text}
    </p>
  );
}

function Editor({ client, copy, editor }: Props & { readonly editor: NotesEditorVM }): JSX.Element {
  const text = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const errorText = useErrorText();
  useEffect(() => {
    const field = text.current;
    if (field === null) return;
    field.focus({ preventScroll: false });
    field.setSelectionRange(field.value.length, field.value.length);
  }, [editor.noteId]);
  const problem = editor.problem;
  const fields = editor.asText ? null : editor.form;
  const first = fields?.find((part): part is FieldPart => part.kind === 'field');
  // A rewrite stands under its field; with no field to stand under (the text, a field edited away) — after them.
  const placed = new Set(fields?.flatMap((part) => (part.kind === 'field' ? part.suggestions.map((suggestion) => suggestion.index) : [])));
  const loose = editor.suggestions.filter((suggestion) => !placed.has(suggestion.index));
  return (
    <div
      class="cg-notes__edit"
      data-notes-editor={editor.noteId ?? 'new'}
      {...(editor.fill === null ? {} : { 'data-notes-fill': editor.fill.status })}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !isComposing(event)) {
          event.preventDefault();
          client.dispatch({ type: 'save' });
        }
      }}
    >
      <div class="cg-notes__edit-head">
        <TextField value={editor.title} label={copy.titlePlaceholder} placeholder={copy.titlePlaceholder} onValue={(title) => client.dispatch({ type: 'input', title, text: editor.text })} {...(editor.saving ? { reason: copy.saving } : {})} />
        {editor.form === null ? null : (
          <Button
            variant="quiet"
            size="sm"
            label={editor.asText ? copy.asFields : copy.asText}
            tooltip={editor.asText ? copy.asFieldsHint : copy.asTextHint}
            class="cg-notes__mode"
            {...(editor.saving ? { reason: copy.saving } : {})}
            onClick={() => client.dispatch({ type: 'as-text', on: !editor.asText })}
          />
        )}
      </div>
      {fields === null ? (
        <TextField
          multiline
          minHeight={72}
          maxHeight={320}
          value={editor.text}
          label={copy.textPlaceholder}
          placeholder={copy.textPlaceholder}
          inputRef={text}
          onValue={(value) => client.dispatch({ type: 'input', title: editor.title, text: value })}
          // The field's Esc keeps the draft and the panel: nothing typed goes by a stray key.
          onEscape={() => true}
          {...(editor.saving ? { reason: copy.saving } : {})}
        />
      ) : (
        <div class="cg-notes__rows" data-notes-fields="">
          {fields.map((part, at) =>
            part.kind === 'text' ? (
              <div key={`t${String(at)}`} class="cg-notes__free" title={copy.freeLine}>
                {part.text}
              </div>
            ) : (
              <FieldRow key={`f${part.label}`} client={client} copy={copy} part={part} saving={editor.saving} {...(part === first ? { inputRef: text } : {})} />
            ),
          )}
        </div>
      )}
      {loose.map((suggestion) => (
        <Suggestion key={suggestion.index} client={client} copy={copy} suggestion={suggestion} named saving={editor.saving} />
      ))}
      {editor.fill === null ? null : <FillLine copy={copy} fill={editor.fill} offered={editor.suggestions.length} />}
      {problem === null ? null : (
        <p class="cg-notes__problem" role="alert" data-notes-problem={problem.kind}>
          {problem.kind === 'failed' ? problem.error.code === 'CG-NOTE-WRITE' && problem.error.detail === 'changed' ? copy.problem.changed : `${errorText(problem.error)}. ${copy.problem[problem.created ? 'failed-create' : 'failed-edit']}` : copy.problem[problem.kind]}
        </p>
      )}
    </div>
  );
}

function NoteItem({ client, copy, vm, note }: Props & { readonly vm: NotesPanelVM; readonly note: FanslyNote }): JSX.Element {
  const errorText = useErrorText();
  const asked = vm.confirmDelete === note.noteId;
  const deleting = vm.deleting === note.noteId;
  const form = vm.forms[note.noteId];
  return (
    <li class={`cg-notes__note${note.foreign ? ' is-foreign' : ''}`} data-note-id={note.noteId} {...(note.foreign ? { 'data-foreign': 'true' } : {})}>
      <div class="cg-notes__note-head">
        <span class="cg-notes__note-title">{note.title !== '' ? note.title : form === undefined ? copy.untitled : copy.questionnaire}</span>
        {note.foreign ? (
          <span class="cg-notes__tag" title={copy.foreignHint}>
            <Icon name="lock" size={12} />
            {copy.foreign}
          </span>
        ) : vm.editor === null && !asked ? (
          <span class="cg-notes__note-acts">
            <Button variant="quiet" size="sm" label={copy.edit} onClick={() => client.dispatch({ type: 'edit', noteId: note.noteId })} />
            <Button variant="quiet" size="sm" label={copy.remove} onClick={() => client.dispatch({ type: 'ask-delete', noteId: note.noteId })} />
          </span>
        ) : null}
      </div>
      {form !== undefined ? <FormView copy={copy} form={form} /> : note.text === '' ? null : <p class="cg-notes__note-text">{note.text}</p>}
      {asked ? (
        <div class="cg-notes__confirm" role="alert" data-notes-confirm="">
          <span class="cg-notes__confirm-t">{vm.deleteError === null ? copy.removeAsk : errorText(vm.deleteError)}</span>
          <Button variant="line" size="sm" label={deleting ? copy.removing : copy.remove} busy={deleting} onClick={() => client.dispatch({ type: 'delete' })} />
          <Button variant="quiet" size="sm" label={copy.keep} {...(deleting ? { reason: copy.removing } : {})} onClick={() => client.dispatch({ type: 'keep' })} />
        </div>
      ) : null}
    </li>
  );
}

function Body({ client, copy, vm }: Props & { readonly vm: NotesPanelVM }): JSX.Element {
  const errorText = useErrorText();
  const editor = vm.editor;
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
      <ul class="cg-notes__list">
        {editor !== null && editor.noteId === null ? (
          <li class="cg-notes__note">
            <Editor client={client} copy={copy} editor={editor} />
          </li>
        ) : null}
        {vm.notes.map((note) =>
          editor !== null && editor.noteId === note.noteId ? (
            <li key={note.noteId} class="cg-notes__note" data-note-id={note.noteId}>
              <Editor client={client} copy={copy} editor={editor} />
            </li>
          ) : (
            <NoteItem key={note.noteId} client={client} copy={copy} vm={vm} note={note} />
          ),
        )}
      </ul>
      {vm.notes.length === 0 && editor === null ? <p class="cg-notes__empty">{copy.empty}</p> : null}
    </>
  );
}

function Foot({ client, copy, vm }: Props & { readonly vm: NotesPanelVM }): JSX.Element {
  const { deps } = useKit();
  const key = hotkeyText(deps.catalog.entry('notes').hotkey);
  const mac = key?.display.includes('⌘') === true;
  const editor = vm.editor;
  if (editor !== null) {
    const filling = editor.fill?.status === 'running';
    const off = editor.saving || editor.blocked || filling;
    return (
      <footer class="cg-notes__foot">
        <button
          type="button"
          class={`cg-act cg-act--main${editor.saving ? ' is-busy' : ''}`}
          title={filling ? copy.filling : copy.saveHint}
          data-notes-save=""
          {...(off ? { 'aria-disabled': 'true' } : {})}
          onClick={() => off || client.dispatch({ type: 'save' })}
        >
          <span class="cg-act__t">{editor.saving ? copy.saving : editor.noteId === null ? copy.create : copy.save}</span>
          <kbd aria-hidden="true">{mac ? '⌘↵' : 'Ctrl+↵'}</kbd>
        </button>
        <Button variant="plain" label={copy.cancel} {...(editor.saving ? { reason: copy.saving } : {})} onClick={() => client.dispatch({ type: 'cancel' })} />
        <span class="cg-notes__spacer" />
        {editor.fill === null ? null : filling ? (
          <Button variant="line" label={copy.fillStop} class="cg-notes__fill-act" onClick={() => client.dispatch({ type: 'fill-stop' })} />
        ) : (
          <Button variant="line" label={copy.fill} tooltip={copy.fillHint} class="cg-notes__fill-act" {...(editor.saving ? { reason: copy.saving } : {})} onClick={() => client.dispatch({ type: 'fill' })} />
        )}
      </footer>
    );
  }
  return (
    <footer class="cg-notes__foot">
      {vm.body === 'ready' ? (
        <>
          <Button variant="line" label={copy.add} onClick={() => client.dispatch({ type: 'create', template: false })} />
          {vm.template ? <Button variant="line" label={copy.template} onClick={() => client.dispatch({ type: 'create', template: true })} /> : null}
        </>
      ) : null}
      <span class="cg-notes__spacer" />
      <select class="cg-notes__view" aria-label={copy.viewLabel} title={copy.viewLabel} value={vm.view} onChange={(event) => client.dispatch({ type: 'view', view: event.currentTarget.value as FanslyNotesView })}>
        {FANSLY_NOTES_VIEWS.map((view) => (
          <option key={view} value={view}>
            {copy.views[view]}
          </option>
        ))}
      </select>
      {key === null ? null : (
        <kbd class="cg-notes__kbd" title={copy.hotkey}>
          {key.display}
        </kbd>
      )}
    </footer>
  );
}

export function NotesPanel({ client, texts }: { readonly client: NotesClient; readonly texts: NotesTexts }): JSX.Element | null {
  useNotesTick(client);
  const copy = texts[useI18n().language];
  const vm = client.panel();
  const card = useRef<HTMLElement | null>(null);
  const center = vm.view === 'center';
  // The centred window takes the focus as it opens; the side panel leaves it where the person works.
  useEffect(() => {
    if (vm.shown && center) card.current?.focus({ preventScroll: true });
  }, [vm.shown, center]);
  if (!vm.shown) return null;
  const closable = !center ? vm.view !== 'docked' || vm.narrow : true;
  const place = vm.place;
  const busy = vm.body === 'loading' || vm.writing;
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
            {vm.body === 'ready' ? <NameField client={client} copy={copy} vm={vm} /> : <span class="cg-notes__name">{vm.fan?.name ?? copy.fan}</span>}
            {vm.fan === null || vm.fan.handle === null ? null : <span class="cg-notes__handle">@{vm.fan.handle}</span>}
          </div>
          <Button variant="quiet" size="sm" iconOnly icon="refresh" label={copy.refresh} tooltip={copy.refreshHint} {...(busy ? { busy: true } : {})} onClick={() => client.dispatch({ type: 'refresh' })} />
          {closable ? <Button variant="quiet" size="sm" iconOnly icon="x" label={copy.close} onClick={() => client.dispatch({ type: 'close' })} /> : null}
        </div>
      </header>
      <div class="cg-notes__body">
        <Body client={client} copy={copy} vm={vm} />
      </div>
      <Foot client={client} copy={copy} vm={vm} />
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
