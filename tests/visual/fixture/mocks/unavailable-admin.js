// UI recovery tests must never contact an administrative or catalogue service.
export function createAdminClient() { throw new Error('External writes are disabled in the visual fixture.') }
