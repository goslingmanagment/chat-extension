import { describe, expect, it } from 'vitest';
import { registrationFanId } from '../bg/fansly/registration';

const group = { id: '456', type: 1, users: [{ userId: '123' }, { userId: '789' }] };

describe('Fansly registration background', () => {
  it('[FS-REG-2] [FS-REG-3] accepts only the two-member group containing this creator, never its group id or createdBy', () => {
    expect(registrationFanId({ ...group, createdBy: '456' }, '456', '123')).toBe('789');
    for (const bad of [{ ...group, id: '789' }, { ...group, type: 3 }, { ...group, users: [...group.users, { userId: '999' }] }, { ...group, users: [{ userId: '123' }, { userId: '123' }] }, { ...group, users: [{ userId: '456' }, { userId: '789' }] }, { ...group, users: [{ userId: '123' }, { userId: 789 }] }]) expect(registrationFanId(bad, '456', '123')).toBeNull();
  });
});
