import { auth } from './firebase';

const API_BASE = (process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL || 'https://us-central1-visa-licences.cloudfunctions.net/api').replace(/\/$/, '');

export async function callApi<T = any>(path: string, body: any = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in again.');
  const token = await user.getIdToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}
