import most from 'most'
import fwitch from 'fwitch'

import * as vrender from './vrender'

const API_ENDPOINT = process.env.NODE_PRODUCTION ? 'api.' + window.location.hostname : process.env.API_ENDPOINT

export default function main ({NAV, MAIN, HTTP, ROUTER, STORAGE}) {
  let match$ = ROUTER.define({
    '/': {where: 'HOME'},
    '/account': {where: 'ACCOUNT'},
    '/endpoints': {where: 'ENDPOINTS'},
    '/endpoints/:endpoint': id => ({where: 'ENDPOINT', id})
  })

  let response$ = HTTP
    .flatMap(r$ => r$
      .recoverWith(err => console.log('got err', err) || most.of({body: {error: err.message}}))
    )
    .map(response => response.body)
    .startWith({})

  // let notify$ = response$
  //   .tap(console.log.bind(console, 'notify'))

  let session$ = response$
    .filter(r => r.jwt !== undefined)
    .merge(
      STORAGE.items
        .filter(([key]) => key === 'session')
        .map(([_, value]) => JSON.parse(value))
    )
    .startWith({})
    .multicast()
    .tap(session => console.log('session', session))

  let created$ = response$
    .filter(r => r.live_url)

  let nheaders$ = most.merge(
    MAIN.select('.header-add').events('click').tap(e => e.preventDefault()).constant(1),
    MAIN.select('.header-remove').events('click').tap(e => e.preventDefault()).constant(-1)
  )
    .scan((acc, v) => (acc + v) || 1, 2)

  let state$ = most.combine(
    (match, endpoints, nheaders) => ({match, endpoints, nheaders}),
    match$,
    response$
      .filter(r => r.endpoints)
      .map(r => r.endpoints)
      .startWith([]),
    nheaders$
  )

  let vtree$ = state$
    .map(({match, endpoints, nheaders}) =>
      fwitch(match.value.where, {
        ENDPOINTS: vrender.list.bind(vrender, endpoints),
        ENDPOINT: vrender.endpoint.bind(vrender, endpoints[match.value.id], nheaders),
        default: vrender.create.bind(vrender, nheaders)
      })
    )

  let nav$ = session$
    .map(vrender.nav)

  let auth$ = NAV.select('form').events('submit')
    .tap(e => e.preventDefault())
    .map(e => ({
      url: '/auth',
      method: 'POST',
      send: {
        email: e.target.querySelector('input').value.trim()
      }
    }))

  let create$ = MAIN.select('form.set').events('submit')
    .tap(e => e.preventDefault())
    .map(e => ({
      method: 'POST',
      url: '/e/',
      send: {
        url: e.target.querySelector('[name="url"]').value.trim(),
        definition: e.target.querySelector('[name="definition"]').value.trim(),
        headers: (() => {
          let keys = e.target.querySelectorAll('[name="header-key"]')
          let vals = e.target.querySelectorAll('[name="header-val"]')
          var headers = {}
          for (let i = 0; i < keys.length; i++) {
            let key = keys[i].value.trim()
            let val = vals[i].value.trim()
            if (key && val) {
              headers[key] = val
            }
          }
          return headers
        })()
      }
    }))

  let fetchList$ = match$
    .filter(match => match.value.where === 'ENDPOINTS' || match.value.where === 'ENDPOINT')
    .map(() => ({url: '/e/'}))

  let sel = 'a[href^="#/"]'
  let href$ = most.merge(MAIN.select(sel).events('click'), NAV.select(sel).events('click'))
    .map(e => e.target.href.slice(1))

  let request$ = most.empty()
    .merge(create$)
    .merge(auth$)
    .merge(fetchList$)
    .multicast()

  return {
    MAIN: vtree$,
    NAV: nav$,
    HTTP: request$
      .sample((req, session) => {
        if (session && session.jwt) req.headers = {'Authorization': `Bearer ${session.jwt}`}
        return req
      }, request$, session$)
      .tap(req => req.url = API_ENDPOINT + req.url),
    ROUTER: most.empty()
      .merge(href$)
      .merge(created$.map(c => `/endpoints/${c.identifier}`))
      .startWith(window.location.hash)
      .multicast(),
    STORAGE: session$.map(session => STORAGE.setItem('session', JSON.stringify(session)))
      .startWith(STORAGE.getItem('session'))
      .multicast()
  }
}
