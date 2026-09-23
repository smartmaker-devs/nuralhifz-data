/* Connexion GitHub par code (« device flow »), pour marquer depuis le telephone.
 *
 * Le navigateur ne peut pas parler directement a github.com/login/... : ces
 * URL ne renvoient pas d'en-tete CORS. Cette fonction sert uniquement de relais.
 *
 *   POST /api/device?step=start  → { user_code, verification_uri, device_code, interval }
 *   POST /api/device?step=poll   → { access_token } | { error: "authorization_pending" }
 *
 * Aucun secret n'est necessaire : le device flow est prevu pour les clients
 * publics. Le seul reglage est GITHUB_CLIENT_ID (variable d'environnement
 * Vercel), l'identifiant public de l'OAuth App. Le jeton produit appartient a
 * l'utilisateur qui approuve le code, il n'est jamais stocke ici : il repart
 * vers le navigateur, qui le garde sur l'appareil.
 */
const SCOPE = 'public_repo'   // le depot de donnees est public : ecriture sur les depots publics suffit

async function gh(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const client_id = process.env.GITHUB_CLIENT_ID
  if (!client_id) return res.status(500).json({ error: 'missing_client_id', hint: 'Definir GITHUB_CLIENT_ID dans les variables Vercel.' })

  const step = req.query.step
  if (step === 'start') {
    const { status, data } = await gh('https://github.com/login/device/code', { client_id, scope: SCOPE })
    if (data.error || !data.device_code) return res.status(status === 200 ? 502 : status).json(data)
    return res.status(200).json({
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires_in: data.expires_in,
      interval: data.interval ?? 5,
    })
  }

  if (step === 'poll') {
    const device_code = (req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}')).device_code
    if (!device_code) return res.status(400).json({ error: 'missing_device_code' })
    const { data } = await gh('https://github.com/login/oauth/access_token', {
      client_id, device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })
    // authorization_pending / slow_down ne sont pas des echecs : l'utilisateur
    // n'a pas encore saisi son code. On repond 200, le navigateur reessaie.
    return res.status(200).json(data)
  }

  return res.status(400).json({ error: 'unknown_step' })
}
