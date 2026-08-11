# Real push notifications — setup recipe

**Status: not implemented in the app.** This is the deployment recipe for when
you want it. It is deliberately kept as a document rather than dormant app code,
because none of it can be tested until the server side exists.

## Why the current reminders are limited

`src/lib/notifications.ts` schedules reminders with `setTimeout`. That means:

- they only fire while a tab is **open** (timers die when it closes);
- browsers throttle timers in background tabs;
- so the exact case you'd want most — "remind me 30 min before dawn on Saturday"
  while the app is closed — does not work.

The app mitigates this by re-arming timers on every start and whenever the tab
regains focus (`App.vue` → `rearmReminders`), but reminders still cannot fire
with the app fully closed. Only **Web Push** can do that, and Web Push requires
a server to send the message.

## What real push needs

1. A **VAPID keypair** (public key ships in the client, private key stays a
   server secret).
2. A **`push_subscriptions` table** to store each device's subscription.
3. A **service-worker `push` handler** to display the notification.
4. A **scheduled server job** that decides when to send (this is the real work:
   it must score windows server-side, which means porting the scoring engine or
   calling the weather APIs from the function).

Step 4 is the reason this isn't a quick win: the scoring engine currently runs
only in the browser. A server-side sender needs that logic available in the
edge function too.

## 1. Generate VAPID keys

```bash
npx web-push generate-vapid-keys
```

Keep the private key secret. Add the public key as a build-time env var
(`VITE_VAPID_PUBLIC_KEY`) and the private key as a Supabase secret.

## 2. Table + RLS

```sql
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "own subs" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## 3. Client: subscribe

`vite-plugin-pwa` already registers a service worker. Add to the app (e.g. in
`lib/notifications.ts`) after permission is granted:

```ts
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export async function subscribeToPush(): Promise<boolean> {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
  })
  const json = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: (await supabase.auth.getUser()).data.user!.id,
    endpoint: json.endpoint!,
    p256dh: json.keys!.p256dh,
    auth: json.keys!.auth,
  }, { onConflict: 'endpoint' })
  return !error
}
```

## 4. Service worker: display the push

`vite-plugin-pwa` must switch to `injectManifest` mode with a custom SW so a
`push` listener can be added:

```js
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? '🎣 FishCast', {
      body: data.body ?? '',
      icon: '/fishcast/v2/icons/icon.svg',
      tag: data.tag,
      data: { url: data.url ?? '/fishcast/v2/#/dashboard' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data.url))
})
```

## 5. Edge function: send

```ts
// supabase/functions/send-reminders/index.ts
import webpush from 'npm:web-push'

webpush.setVapidDetails(
  'mailto:you@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

Deno.serve(async () => {
  // 1. read users' setups (locations + availability + species)
  // 2. score the next ~24h — REQUIRES the scoring engine server-side
  // 3. for each user with a window >= 55 starting in ~30 min, send:
  //    await webpush.sendNotification(sub, JSON.stringify({ title, body, tag }))
  // 4. delete subscriptions that return 404/410 (expired)
  return new Response('ok')
})
```

Deploy and schedule (every 15 min):

```bash
supabase functions deploy send-reminders
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
```

```sql
select cron.schedule('fishcast-reminders', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/send-reminders',
    headers := '{"Authorization": "Bearer <service_role_key>"}'::jsonb
  );
$$);
```

## Practical notes

- **iOS**: web push only works for apps added to the Home Screen (PWA), iOS 16.4+.
- **Sharing the scoring engine** is the main refactor: extract `lib/scoring.ts`
  (already pure, and its weights are centralised in `SCORE_WEIGHTS`) plus
  `solunar.ts` / `weather.ts` into something the Deno function can import.
- **Expired subscriptions** must be pruned on 404/410, or the sender slowly
  fills with dead endpoints.
