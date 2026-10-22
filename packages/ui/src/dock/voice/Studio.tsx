// The voice studio (1.47.0): the dock's sheet of the Voice chip, on both
// sites. The script on the left — the presets, the editor (a draft card: the
// AI's text that has not gone anywhere), the tags, the count — and the takes
// on the right, each with its own player and waveform; one column on a narrow
// composer. The footer holds the next step: «Озвучить» while no take of this
// text is ready, «Прикрепить для …» once one is, «Ещё вариант» beside it.
// What a click costs is said on the button itself.

import { type JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { VOICE_TAGS, type VoiceTag, type VoiceTone } from '@cg/contracts/voice';
import { type VoiceAttachVM, type VoiceTakeVM, type VoiceVM } from '@cg/contracts/vm';

import { ActionButton, Button, Caret, Dot, ElapsedTimer, ErrorCard, Icon, Segmented, Spinner, useDispatch, useI18n, useKit, useTooltip, useView, windowOf } from '../../kit';
import { Head, HideButton } from '../Head';
import { type VoiceProps } from '../lazy-part';
import { toneOf } from '../model';
import { WAVE_BARS, clockText, decodeTake, nowPlaying, play, positionOf, stop, type DecodedTake } from './player';

const TAG_KEYS: Readonly<Record<VoiceTag, I18nKey>> = {
  '[warmly]': 'voice.tag.warmly',
  '[cheerfully]': 'voice.tag.cheerfully',
  '[thoughtful]': 'voice.tag.thoughtful',
  '[excited]': 'voice.tag.excited',
  '[whispers]': 'voice.tag.whispers',
  '[chuckles]': 'voice.tag.chuckles',
  '[giggles]': 'voice.tag.giggles',
  '[sighs]': 'voice.tag.sighs',
  '[short pause]': 'voice.tag.shortPause',
  '[long pause]': 'voice.tag.longPause',
};

export function VoiceStudio({ onHide }: VoiceProps): JSX.Element {
  const i18n = useI18n();
  const vm = useView({ of: 'voice' }).value;
  const hide = (): void => {
    stop();
    onHide();
  };
  // Leaving the studio (another chat, another sheet) stops what plays.
  useEffect(() => () => stop(), []);
  const handle = vm.targetHandle;
  const title = i18n.t('dock.action.voice');
  if (vm.view.s === 'loading' || handle === null) {
    return <Head title={title} fan={vm.fanName} gutter={vm.view.s === 'loading' ? <Spinner label={i18n.t('common.loading')} /> : null} acts={<HideButton onClick={hide} />} />;
  }
  const ready = vm.takes.filter((take) => take.state === 'ready').length;
  return (
    <>
      <Head title={title} fan={vm.fanName} gutter={vm.stage === 'writing' ? <Spinner /> : null} acts={<HideButton onClick={hide} />}>
        {vm.stage === 'writing' ? <span class="cg-head__meta">{i18n.t('voice.writing')}</span> : null}
      </Head>
      <div class="cg-body cg-voice">
        {vm.error === null ? null : (
          <div class="cg-voice__err">
            <ErrorCard error={vm.error} tone={toneOf(vm.error)} />
          </div>
        )}
        {vm.confirm === null ? null : <Confirm confirm={vm.confirm} />}
        <div class={vm.takes.length === 0 ? 'cg-voice__cols is-single' : 'cg-voice__cols'}>
          <Script vm={vm} handle={handle} />
          {vm.takes.length === 0 ? null : <Takes vm={vm} handle={handle} choosing={ready > 1} />}
        </div>
      </div>
      <Footer vm={vm} />
    </>
  );
}

// ── the script ───────────────────────────────────────────────────────────────

function Script({ vm, handle }: { readonly vm: VoiceVM; readonly handle: string }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const toneReason = vm.toneReason === null ? null : i18n.text(vm.toneReason.text);
  const writeTone = (tone: VoiceTone): void => void dispatch({ type: 'WriteVoiceScript', targetHandle: handle, tone, from: vm.stage === 'ready' || vm.stage === 'failed' ? 'session' : 'field' });
  const script = vm.script;
  const tones = (
    <div class="cg-voice__tones">
      <Segmented
        label={i18n.t('voice.tone.label')}
        size="sm"
        value={vm.tone}
        options={vm.tones.map((tone) => ({ value: tone, label: i18n.t(`voice.tone.${tone}`), reason: toneReason }))}
        onChange={writeTone}
      />
      {vm.stage === 'ready' ? (
        <Button label={i18n.t('voice.rewrite')} icon="refresh" size="sm" variant="quiet" class="cg-voice__rewrite" tooltip={i18n.t('voice.rewriteTooltip')} reason={toneReason} onClick={() => writeTone(vm.tone)} />
      ) : null}
      <span class="cg-voice__sp" />
      {vm.stage === 'writing' ? <Button label={i18n.t('voice.cancel')} size="sm" variant="quiet" onClick={() => void dispatch({ type: 'CancelVoiceScript', targetHandle: handle })} /> : null}
    </div>
  );

  if (script === null) {
    return (
      <section class="cg-voice__script" aria-label={i18n.t('voice.script.label')}>
        {tones}
        <div class="cg-voice__empty">
          <span class="cg-voice__mic">
            <Icon name="mic" />
          </span>
          <span class="cg-voice__empty-t">
            <b>{i18n.t('voice.empty.title')}</b>
            <span>{i18n.t('voice.empty.body')}</span>
          </span>
        </div>
      </section>
    );
  }
  return (
    <section class="cg-voice__script" aria-label={i18n.t('voice.script.label')}>
      {tones}
      {script.streaming ? (
        <div class="cg-voice__draft is-streaming">
          {script.text}
          <Caret />
        </div>
      ) : (
        <Editor script={script} handle={handle} />
      )}
      {script.issue === null || script.streaming ? null : (
        <div class="cg-voice__issue" role="status">
          <Dot kind="ring" />
          <span>{i18n.text(script.issue)}</span>
        </div>
      )}
      {vm.source === null ? null : <Source text={vm.source} />}
    </section>
  );
}

/**
 * The script as the person edits it. The field is theirs while they type: what they typed shows at once, and the
 * view's echo of it never pulls the text back; a text the view brings from elsewhere (a new script, «Вернуть текст
 * AI», another tab) replaces it.
 */
function Editor({ script, handle }: { readonly script: NonNullable<VoiceVM['script']>; readonly handle: string }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(script.text);
  const sent = useRef<string[]>([]);
  const [tags, setTags] = useState(false);

  useLayoutEffect(() => {
    const at = sent.current.indexOf(script.text);
    if (at >= 0) {
      sent.current.splice(0, at + 1);
      return;
    }
    sent.current = [];
    setText(script.text);
  }, [script.text]);

  // The editor grows with the text up to its cap (CSS), then scrolls.
  useLayoutEffect(() => {
    const element = field.current;
    if (element === null) return;
    element.style.height = 'auto';
    element.style.height = `${String(element.scrollHeight + 2)}px`;
  }, [text]);

  const edit = (next: string): void => {
    sent.current.push(next);
    setText(next);
    void dispatch({ type: 'EditVoiceScript', targetHandle: handle, text: next });
  };

  /** A tag goes where the caret is, a space on each side where none is; the caret lands after it. */
  const insertTag = (tag: VoiceTag): void => {
    const element = field.current;
    if (element === null) return;
    const value = element.value;
    const before = value.slice(0, element.selectionStart);
    const after = value.slice(element.selectionEnd);
    const left = before === '' || /\s$/u.test(before) ? '' : ' ';
    const right = after === '' || !/^\s/u.test(after) ? ' ' : '';
    const next = `${before}${left}${tag}${right}${after}`;
    const caret = before.length + left.length + tag.length + right.length;
    element.value = next;
    element.focus();
    element.setSelectionRange(caret, caret);
    edit(next);
  };

  return (
    <>
      <textarea
        ref={field}
        class="cg-voice__draft"
        aria-label={i18n.t('voice.script.label')}
        placeholder={i18n.t('voice.script.placeholder')}
        value={text}
        rows={3}
        spellcheck={false}
        onInput={(event) => edit(event.currentTarget.value)}
        onKeyDown={(event) => {
          // The field is ours: the site's keys (Enter sends on ChatSpace) never see a keystroke typed here.
          if (event.key !== 'Escape') event.stopPropagation();
        }}
      />
      <div class="cg-voice__under">
        <span class={script.chars > script.max ? 'cg-voice__count cg-num is-over' : 'cg-voice__count cg-num'}>{i18n.t('voice.script.counter', { chars: script.chars, max: script.max, seconds: script.seconds })}</span>
        {script.edited ? <span class="cg-voice__edited">{i18n.t('voice.script.edited')}</span> : null}
        <span class="cg-voice__sp" />
        {script.edited ? <Button label={i18n.t('voice.script.revert')} size="sm" variant="quiet" onClick={() => void dispatch({ type: 'RevertVoiceScript', targetHandle: handle })} /> : null}
        <Button label={i18n.t('voice.tags')} size="sm" variant="quiet" class="cg-voice__tagbtn" tooltip={i18n.t('voice.tagsTooltip')} pressed={tags} onClick={() => setTags((open) => !open)} />
      </div>
      {tags ? (
        <div class="cg-voice__tags" role="group" aria-label={i18n.t('voice.tags')}>
          {VOICE_TAGS.map((tag) => (
            <TagChip key={tag} tag={tag} label={i18n.t(TAG_KEYS[tag])} onInsert={insertTag} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function TagChip({ tag, label, onInsert }: { readonly tag: VoiceTag; readonly label: string; readonly onInsert: (tag: VoiceTag) => void }): JSX.Element {
  const tip = useTooltip(tag);
  return (
    <>
      <button
        type="button"
        class="cg-voice__tag"
        {...tip.props}
        // The editor keeps its caret: a click on a chip never takes the focus from it.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onInsert(tag)}
      >
        {label}
      </button>
      {tip.description}
    </>
  );
}

/** «Из черновика: …» — the draft the script was made from, one line; the whole of it in the hint. */
function Source({ text }: { readonly text: string }): JSX.Element {
  const i18n = useI18n();
  const tip = useTooltip(text);
  return (
    <>
      <div class="cg-voice__source" tabIndex={0} {...tip.props}>
        <span class="cg-voice__source-k">{i18n.t('voice.source')}</span>
        <span class="cg-voice__source-t">{text}</span>
      </div>
      {tip.description}
    </>
  );
}

// ── the takes ────────────────────────────────────────────────────────────────

function Takes({ vm, handle, choosing }: { readonly vm: VoiceVM; readonly handle: string; readonly choosing: boolean }): JSX.Element {
  const i18n = useI18n();
  return (
    <section class="cg-voice__takes" aria-label={i18n.t('voice.takes.label')}>
      <div class="cg-voice__cap">{i18n.t('voice.takes.label')}</div>
      <ol class="cg-voice__list">
        {vm.takes.map((take) => (
          <Take key={take.takeId} take={take} selected={vm.selected === take.takeId} choosing={choosing} handle={handle} />
        ))}
      </ol>
    </section>
  );
}

function Take({ take, selected, choosing, handle }: { readonly take: VoiceTakeVM; readonly selected: boolean; readonly choosing: boolean; readonly handle: string }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const ready = take.state === 'ready';
  const label = i18n.t('voice.take', { n: take.n });
  const classes = ['cg-take', `is-${take.state}`, selected && ready ? 'is-selected' : '', take.stale ? 'is-stale' : ''].filter((name) => name !== '').join(' ');
  return (
    <li class={classes} data-cg-take={take.n}>
      <div class="cg-take__row">
        {ready ? (
          <Player take={take} />
        ) : (
          <span class="cg-take__wait">{take.state === 'working' ? <Spinner /> : <Dot kind={take.state === 'refused' || take.state === 'expired' ? 'ring' : 'danger'} />}</span>
        )}
        {ready && choosing ? (
          <Button
            label={label}
            size="sm"
            variant="quiet"
            class="cg-take__n"
            pressed={selected}
            tooltip={i18n.t('voice.take.select', { n: take.n })}
            onClick={() => (selected ? undefined : void dispatch({ type: 'SelectVoiceTake', targetHandle: handle, takeId: take.takeId }))}
          />
        ) : (
          <span class="cg-take__n is-text">{label}</span>
        )}
        <TakeWords take={take} selected={selected && choosing} />
        <span class="cg-voice__sp" />
        {take.check === null ? null : <Button label={i18n.t('voice.take.check')} size="sm" variant="line" tooltip={i18n.t('voice.take.checkTooltip')} onClick={() => void dispatch(take.check!)} />}
        {ready ? (
          <Button
            label={i18n.t('voice.download')}
            icon="download"
            iconOnly
            size="sm"
            variant="quiet"
            class="cg-take__dl"
            reason={take.audio === null ? i18n.t('voice.take.loading') : null}
            onClick={() => void dispatch({ type: 'DownloadVoiceTake', targetHandle: handle, takeId: take.takeId })}
          />
        ) : null}
      </div>
      {take.error === null ? null : (
        <div class="cg-take__err">
          <ErrorCard error={take.error} tone={take.state === 'refused' || take.state === 'expired' ? 'state' : 'failure'} inline alert={false} />
        </div>
      )}
    </li>
  );
}

/** The quiet words after «Вариант 2»: what it does now, what became of it. */
function TakeWords({ take, selected }: { readonly take: VoiceTakeVM; readonly selected: boolean }): JSX.Element | null {
  const i18n = useI18n();
  const words: JSX.Element[] = [];
  if (take.state === 'working') {
    words.push(
      <span key="w" class="cg-take__word">
        {take.slow ? i18n.t('voice.take.slow') : i18n.t('voice.take.working')} <ElapsedTimer since={take.startedAt} />
      </span>,
    );
  }
  if (take.state === 'ready' && take.audio === null && take.error === null) {
    words.push(
      <span key="l" class="cg-take__word">
        {i18n.t('voice.take.loading')}
      </span>,
    );
  }
  if (take.stale && take.state === 'ready') {
    words.push(
      <span key="s" class="cg-take__word">
        {i18n.t('voice.take.stale')}
      </span>,
    );
  }
  if (take.attached === 'attached') {
    words.push(
      <span key="a" class="cg-take__word is-good">
        <Icon name="check" size={12} /> {i18n.t('voice.take.attached')}
      </span>,
    );
  } else if (take.attached === 'unknown') {
    words.push(
      <span key="a" class="cg-take__word">
        {i18n.t('voice.take.attachedUnknown')}
      </span>,
    );
  } else if (selected && take.state === 'ready') {
    words.push(
      <span key="c" class="cg-take__word is-accent">
        {i18n.t('voice.take.selected')}
      </span>,
    );
  }
  if (take.state === 'uncertain' || (take.state === 'failed' && take.charged === null)) {
    words.push(
      <span key="m" class="cg-take__word is-warn">
        {i18n.t('voice.take.maybeCharged')}
      </span>,
    );
  } else if ((take.state === 'refused' || take.state === 'failed' || take.state === 'expired') && take.charged === false) {
    words.push(
      <span key="n" class="cg-take__word">
        {i18n.t('voice.take.notCharged')}
      </span>,
    );
  }
  return words.length === 0 ? null : <span class="cg-take__words">{words}</span>;
}

/** The flat line a waveform shows until its take is decoded. */
const QUIET_PEAKS: readonly number[] = Array.from({ length: WAVE_BARS }, () => 0.1);

/** ▶ and the waveform of a ready take: decoded once, played by Web Audio, one take at a time. */
function Player({ take }: { readonly take: VoiceTakeVM }): JSX.Element {
  const i18n = useI18n();
  const { root } = useKit();
  const win = windowOf(root);
  const [decoded, setDecoded] = useState<DecodedTake | null>(null);
  const [failed, setFailed] = useState(false);
  const [, tick] = useState(0);
  const audio = take.audio;
  const sha = audio?.sha256 ?? null;
  useEffect(() => {
    if (audio === null || win === null) return undefined;
    let alive = true;
    setFailed(false);
    decodeTake(win, audio.sha256, audio.bytes).then(
      (value) => {
        if (alive) setDecoded(value);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [sha, win]);
  const now = nowPlaying.value;
  const isPlaying = now !== null && sha !== null && now.sha256 === sha;
  // While this take plays, the waveform follows it frame by frame; otherwise nothing ticks.
  useLayoutEffect(() => {
    if (!isPlaying || win === null) return undefined;
    let frame = win.requestAnimationFrame(function step() {
      tick((count) => count + 1);
      frame = win.requestAnimationFrame(step);
    });
    return () => win.cancelAnimationFrame(frame);
  }, [isPlaying, win]);
  const position = sha === null || win === null || !isPlaying ? 0 : (positionOf(win, sha) ?? 0);
  const duration = decoded?.duration ?? 0;
  const progress = duration > 0 ? position / duration : 0;
  const toggle = (): void => {
    if (win === null || decoded === null || sha === null) return;
    if (isPlaying) stop();
    else play(win, sha, decoded, 0).catch(() => setFailed(true));
  };
  const seekTo = (seconds: number): void => {
    if (win === null || decoded === null || sha === null) return;
    play(win, sha, decoded, Math.max(0, Math.min(decoded.duration, seconds))).catch(() => setFailed(true));
  };
  if (failed) {
    return (
      <span class="cg-take__player is-failed">
        <span class="cg-take__fail">{i18n.t('voice.take.playFailed')}</span>
      </span>
    );
  }
  const peaks = decoded?.peaks ?? QUIET_PEAKS;
  return (
    <span class="cg-take__player">
      <button
        type="button"
        class={isPlaying ? 'cg-take__play is-on' : 'cg-take__play'}
        aria-label={i18n.t(isPlaying ? 'voice.take.pause' : 'voice.take.play', { n: take.n })}
        aria-pressed={isPlaying ? 'true' : 'false'}
        {...(decoded === null ? { 'aria-disabled': 'true' } : {})}
        onClick={toggle}
      >
        <Icon name={isPlaying ? 'pause' : 'play'} size={12} />
      </button>
      <span
        class={decoded === null ? 'cg-take__wave is-wait' : 'cg-take__wave'}
        role="slider"
        aria-label={i18n.t('voice.take.seek', { n: take.n })}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${clockText(position)} / ${clockText(duration)}`}
        tabIndex={decoded === null ? -1 : 0}
        onClick={(event) => {
          if (decoded === null) return;
          const box = event.currentTarget.getBoundingClientRect();
          seekTo(((event.clientX - box.left) / Math.max(1, box.width)) * decoded.duration);
        }}
        onKeyDown={(event) => {
          if (decoded === null) return;
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            event.stopPropagation();
            seekTo(position + (event.key === 'ArrowRight' ? 2 : -2));
          } else if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            toggle();
          }
        }}
      >
        {peaks.map((peak, index) => (
          <i key={index} class={(index + 0.5) / peaks.length <= progress ? 'is-past' : undefined} style={{ height: `${String(Math.round(3 + peak * 17))}px` }} />
        ))}
      </span>
      <span class="cg-take__time cg-num">{decoded === null ? '–:––' : isPlaying ? clockText(position) : clockText(duration)}</span>
    </span>
  );
}

// ── the question, the handover, the footer ──────────────────────────────────

function Confirm({ confirm }: { readonly confirm: NonNullable<VoiceVM['confirm']> }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return (
    <div class="cg-voice__confirm" role="group" aria-label={i18n.text(confirm.question)}>
      <span class="cg-voice__confirm-t">
        <b>{i18n.text(confirm.lead)}.</b> {i18n.text(confirm.question)}
      </span>
      <span class="cg-voice__confirm-a">
        <ActionButton vm={confirm.confirm} variant="line" size="sm" class="cg-voice__yes" />
        <Button label={i18n.t('common.cancel')} size="sm" variant="quiet" onClick={() => void dispatch(confirm.cancel)} />
      </span>
    </div>
  );
}

function AttachLine({ attach }: { readonly attach: VoiceAttachVM }): JSX.Element {
  const i18n = useI18n();
  switch (attach.state) {
    case 'handing':
    case 'waiting':
      return (
        <div class="cg-voice__attach" role="status">
          <Spinner /> <span>{i18n.t('voice.attach.waiting')}</span>
        </div>
      );
    case 'attached':
      return (
        <>
          <div class="cg-voice__attach is-done" role="status">
            <Icon name="check" size={14} />
            <span>{i18n.t('voice.attach.attached', { n: attach.n })}</span>
          </div>
          <Leftover leftover={attach.leftover} />
        </>
      );
    case 'unknown':
      return (
        <>
          <div class="cg-voice__attach is-unknown" role="status">
            <Dot kind="ring" />
            <span>{i18n.t('voice.attach.unknown', { n: attach.n })}</span>
          </div>
          <Leftover leftover={attach.leftover} />
        </>
      );
    case 'failed':
      return (
        <div class="cg-voice__attach is-failed">
          {attach.error === null ? <span>{i18n.t('voice.attach.failed', { n: attach.n })}</span> : <ErrorCard error={attach.error} tone={toneOf(attach.error)} inline />}
        </div>
      );
  }
}

/** The draft's text left in the field after a take went in: «Убрать текст»; once taken out, «Вернуть текст». */
function Leftover({ leftover }: { readonly leftover: VoiceAttachVM['leftover'] }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (leftover === null) return null;
  const action = leftover.action;
  return (
    <div class={leftover.cleared ? 'cg-voice__leftover is-cleared' : 'cg-voice__leftover'} role="status">
      {leftover.cleared ? <Icon name="check" size={14} /> : <Dot kind="ring" />}
      <span class="cg-voice__leftover-t">{i18n.t(leftover.cleared ? 'voice.leftoverCleared' : 'voice.leftover')}</span>
      {action === null ? null : <Button label={i18n.t(leftover.cleared ? 'voice.leftoverRestore' : 'voice.leftoverClear')} size="sm" variant="line" onClick={() => void dispatch(action)} />}
    </div>
  );
}

function Footer({ vm }: { readonly vm: VoiceVM }): JSX.Element | null {
  if (vm.primary === null && vm.secondary === null && vm.restart === null && vm.again === null && vm.attach === null) return null;
  return (
    <footer class="cg-voice__foot">
      {vm.attach === null ? null : <AttachLine attach={vm.attach} />}
      <div class="cg-voice__acts">
        {vm.restart === null ? null : <ActionButton vm={vm.restart} variant="quiet" class="cg-voice__restart" />}
        <span class="cg-voice__sp" />
        {vm.again === null ? null : <ActionButton vm={vm.again} variant="quiet" />}
        {vm.secondary === null ? null : <ActionButton vm={vm.secondary} variant="line" />}
        {vm.primary === null ? null : <ActionButton vm={vm.primary} variant="line" class="cg-voice__go" />}
      </div>
    </footer>
  );
}
