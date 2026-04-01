// @group Authentication : Session token management and WebAuthn (passkey) helpers

import { getActiveServer, serverTokenKey } from '@/lib/servers'

// @group Authentication > Session : Read/write/clear the session token for the active server
export function getSessionToken(): string | null {
  return localStorage.getItem(serverTokenKey(getActiveServer()))
}

export function setSessionToken(token: string): void {
  localStorage.setItem(serverTokenKey(getActiveServer()), token)
}

export function clearSessionToken(): void {
  localStorage.removeItem(serverTokenKey(getActiveServer()))
}

export function isAuthenticated(): boolean {
  return !!getSessionToken()
}

// @group Authentication > WebAuthn : Base64url encode/decode helpers
function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=')
  const binary = atob(padded)
  const buffer = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    buffer[i] = binary.charCodeAt(i)
  }
  return buffer.buffer
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// @group Authentication > WebAuthn : Convert server CreationChallengeResponse to browser API options
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function prepareCreationOptions(serverOptions: any): PublicKeyCredentialCreationOptions {
  const pk = serverOptions.publicKey
  return {
    ...pk,
    challenge: base64urlToBuffer(pk.challenge),
    user: {
      ...pk.user,
      id: base64urlToBuffer(pk.user.id),
    },
    excludeCredentials: (pk.excludeCredentials ?? []).map((c: { id: string; type: string }) => ({
      ...c,
      id: base64urlToBuffer(c.id),
    })),
  }
}

// @group Authentication > WebAuthn : Convert server RequestChallengeResponse to browser API options
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function prepareRequestOptions(serverOptions: any): PublicKeyCredentialRequestOptions {
  const pk = serverOptions.publicKey
  return {
    ...pk,
    challenge: base64urlToBuffer(pk.challenge),
    allowCredentials: (pk.allowCredentials ?? []).map((c: { id: string; type: string }) => ({
      ...c,
      id: base64urlToBuffer(c.id),
    })),
  }
}

// @group Authentication > WebAuthn : Serialize a registration credential for the server
function serializeRegistrationCredential(cred: PublicKeyCredential): object {
  const response = cred.response as AuthenticatorAttestationResponse
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      attestationObject: bufferToBase64url(response.attestationObject),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
    },
  }
}

// @group Authentication > WebAuthn : Serialize an assertion credential for the server
function serializeAssertionCredential(cred: PublicKeyCredential): object {
  const response = cred.response as AuthenticatorAssertionResponse
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      authenticatorData: bufferToBase64url(response.authenticatorData),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
    },
  }
}

// @group Authentication > WebAuthn : Full passkey registration flow (returns true on success)
export async function registerPasskey(
  startFn: () => Promise<object>,
  finishFn: (cred: object, name: string) => Promise<{ success: boolean }>,
  passkeyName: string,
): Promise<void> {
  if (!window.PublicKeyCredential) {
    throw new Error('WebAuthn is not supported in this browser')
  }
  const serverOptions = await startFn()
  const creationOptions = prepareCreationOptions(serverOptions)
  const credential = await navigator.credentials.create({ publicKey: creationOptions }) as PublicKeyCredential | null
  if (!credential) throw new Error('Passkey creation was cancelled')
  const serialized = serializeRegistrationCredential(credential)
  await finishFn(serialized, passkeyName)
}

// @group Authentication > WebAuthn : Full passkey login flow (returns session token)
export async function loginWithPasskey(
  startFn: () => Promise<object>,
  finishFn: (cred: object) => Promise<{ session_token: string; expires_at: string }>,
): Promise<string> {
  if (!window.PublicKeyCredential) {
    throw new Error('WebAuthn is not supported in this browser')
  }
  const serverOptions = await startFn()
  const requestOptions = prepareRequestOptions(serverOptions)
  const assertion = await navigator.credentials.get({ publicKey: requestOptions }) as PublicKeyCredential | null
  if (!assertion) throw new Error('Passkey authentication was cancelled')
  const serialized = serializeAssertionCredential(assertion)
  const result = await finishFn(serialized)
  return result.session_token
}
