/* Connexion GitHub par code (« device flow »), pour marquer depuis le telephone.
 *
 * Le navigateur ne peut pas parler directement a github.com/login/... : ces
 * URL ne renvoient pas d'en-tete CORS. Cette fonction sert uniquement de relais.
 *
 *   GET  /api/device?step=ping   → { ok: true, ... }  (diagnostic)
 *   POST /api/device?step=start  → { user_code, verification_uri, device_code, interval }
 *   POST /api/device?step=poll   → { access_token } | { error: "authorization_pending" }
 *
 * Ecrit en CommonJS a dessein : sans package.json « type: module » dans ce
 * dossier, Vercel charge api/*.js en CommonJS, et un « export default » y
 * plante au chargement — la fenetre de l'outil affichait alors « — » au lieu
 * du code (2026-09-25).
 *
 * Aucun secret n'est necessaire : le device flow est prevu pour les clients
 * publics. L'identifiant de l'OAuth App est public par nature (il circule dans
 * chaque demande d'autorisation) : il est ecrit ici en clair, ce qui evite
 * tout reglage sur Vercel. GITHUB_CLIENT_ID reste prioritaire si l'application
 * est un jour recreee. Le jeton produit appartient a l'utilisateur qui approuve
 * le code : il n'est jamais stocke ici, il repart vers le navigateur.
 */
// OAuth App « nuralhifz thumn marker », compte ELAHMADI, device flow active.
const DEFAULT_CLIENT_ID = 'Ov23liGNyuC2l6Hgn1AV'
const SCOPE = 'public_repo'   // le depot de donnees est public : cela suffit

async function gh(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  try { return { status: r.status, data: JSON.parse(text) } }
  catch { return { status: r.status, data: { error: 'reponse_illisible', detail: text.slice(0, 200) } } }
}

module.exports = async function handler(req, res) {
  const client_id = process.env.GITHUB_CLIENT_ID || DEFAULT_CLIENT_ID
  const step = (req.query && req.query.step) || ''

  if (step === 'ping') return res.status(200).json({ ok: true, client_id, runtime: process.version })

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (step === 'start') {
    const { status, data } = await gh('https://github.com/login/device/code', { client_id, scope: SCOPE })
    if (!data.device_code) return res.status(status === 200 ? 502 : status).json(data)
    return res.status(200).json({
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires_in: data.expires_in,
      interval: data.interval || 5,
    })
  }

  if (step === 'poll') {
    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    const device_code = body && body.device_code
    if (!device_code) return res.status(400).json({ error: 'missing_device_code' })
    const { data } = await gh('https://github.com/login/oauth/access_token', {
      client_id, device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })
    // authorization_pending / slow_down ne sont pas des echecs : l'utilisateur
    // n'a pas encore saisi son code. On repond 200, le navigateur reessaie.
    return res.status(200).json(data)
  }

  return res.status(400).json({ error: 'unknown_step', step })
}
