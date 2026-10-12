// The sign-in form (architecture.md §8.2, §9.9; ST-011, ST-046, AU-015): a
// login and a password, nothing else. The password lives in this form's
// state only while it is typed; it goes to the background once and is
// cleared here whatever the answer. Host access to the hub address is asked
// inside the click, before the sign-in is sent — the controller does that.

import { type JSX } from 'preact';
import { useState } from 'preact/hooks';

import { type SignInVM } from '@cg/contracts/vm';

import { Button, ErrorCard, useDispatch, useI18n } from '../../kit';
import { Field } from './controls';

export function SignInForm({ vm, onDone }: { readonly vm: SignInVM; readonly onDone?: () => void }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const [login, setLogin] = useState(vm.login);
  const [password, setPassword] = useState('');
  // A new key drops the typed password out of the DOM after every attempt.
  const [attempt, setAttempt] = useState(0);
  const incomplete = login.trim() === '' || password === '';
  const submit = (): void => {
    if (incomplete || vm.busy) return;
    const secret = password;
    setPassword('');
    setAttempt((before) => before + 1);
    void dispatch({ type: 'SignIn', login: login.trim(), password: secret }).then((receipt) => {
      if (receipt?.ok === true) onDone?.();
    });
  };
  return (
    <form
      class="pg-form"
      aria-label={i18n.t('signIn.title')}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label>
        {i18n.t('signIn.login')}
        <Field label={i18n.t('signIn.login')} value={login} autocomplete="username" maxLength={100} onInput={setLogin} onEnter={submit} />
      </label>
      <label>
        {i18n.t('signIn.password')}
        <Field key={attempt} label={i18n.t('signIn.password')} type="password" value="" autocomplete="current-password" maxLength={1024} onInput={setPassword} onEnter={submit} />
      </label>
      <div class="pg-form__acts">
        <Button label={vm.busy ? i18n.t('signIn.pending') : i18n.t('signIn.submit')} variant="line" class="pg-primary" busy={vm.busy} onClick={submit} />
      </div>
      {vm.error === null ? null : <ErrorCard tone={vm.error.code === 'CG-LOGIN-RATE-LIMIT' || vm.error.code === 'CG-LOGIN-PENDING' ? 'state' : 'failure'} error={vm.error} inline copyCode />}
    </form>
  );
}
