import most from 'most'
import hold from '@most/hold'
import fwitch from 'fwitch'
import decodeqs from 'querystring/decode'

import * as vrender from './vrender'

const API_ENDPOINT = process.env.API_ENDPOINT

export default function main ({NAV, MAIN, HTTP, ROUTER, PUSHER, STORAGE}) {
  let match$ = hold(
    ROUTER.define({
      '/': {where: 'HOME'},
      '/logged': {where: 'LOGGED'},
      '/logout': {where: 'LOGOUT'},
      '/documentation': {where: 'DOCUMENTATION'},
      '/create': {where: 'CREATE'},
      '/account': {where: 'ACCOUNT'},
      '/endpoints': {where: 'ENDPOINTS'},
      '/endpoints/:endpoint': id => ({where: 'ENDPOINT', id})
    })
      .skipRepeatsWith((a, b) => a.path === b.path)
  )

  let response$ = HTTP
    .flatMap(r$ => r$
      .recoverWith(err => console.log('got err', err) || most.of({body: {error: err.message}}))
    )
    .map(response => response.body)
    .startWith({})

  let session$ = hold(
    match$
      .filter(match => match.value.where === 'LOGGED')
      .map(match => decodeqs(match.location.search.slice(1)))
      .merge(
        STORAGE.item$
          .filter(([key]) => key === 'session')
          .map(([_, value]) => JSON.parse(value))
          .map(v => v || {})
      )
      .skipRepeatsWith((a, b) => a.jwt === b.jwt)
  )

  let created$ = response$.filter(r => r.endpoint)
  let deleted$ = response$.filter(r => r.deleted)
  let endpoints$ = response$
    .filter(r => r.endpoints)
    .map(r => r.endpoints)
    .startWith({})

  let nheaders$ = most.merge(
    MAIN.select('.header-add').events('click').tap(e => e.preventDefault()).constant(1),
    MAIN.select('.header-remove').events('click').tap(e => e.preventDefault()).constant(-1)
  )
    .scan((acc, v) => (acc + v) || 1, 2)

  let events$ = PUSHER.channel$
    .flatMap(channel =>
      channel.event$
        .map(ev => [channel.id, ev])
    )
    .scan((events, ev) => {
      events.push(ev)
      return events
    }, [])
    .multicast()

  let vtree$ = most.combine(
    (match, endpoints, nheaders, events) =>
      fwitch(match.value.where, {
        HOME: vrender.home.bind(null, nheaders),
        CREATE: vrender.create.bind(null, nheaders),
        DOCUMENTATION: vrender.docs,
        ENDPOINTS: vrender.list.bind(null, endpoints),
        ENDPOINT: vrender.endpoint.bind(null, endpoints[match.value.id], nheaders, events),
        default: vrender.empty
      })
    ,
    match$,
    endpoints$,
    nheaders$,
    events$,
    MAIN.select('button.flush').events('click')
      .tap(e => e.preventDefault())
      .startWith(null)
  )

  let nav$ = session$
    .map(session => vrender.nav(session))

  let endpointRequest$ = MAIN.select('form button.set').events('click')
    .tap(e => e.preventDefault())
    .map(e => e.ownerTarget.parentNode)
    .map(form => ({
      method: form.querySelector('[name="identifier"]') ? 'PUT' : 'POST',
      url: form.querySelector('[name="identifier"]')
        ? `/e/${form.querySelector('[name="identifier"]').value}/`
        : '/e/',
      send: {
        method: (() => {
          let buttons = form.querySelectorAll('[name="method"]')
          for (let i = 0; i < buttons.length; i++) {
            if (buttons[i].checked) return buttons[i].value
          }
        })(),
        url: form.querySelector('[name="url"]').value.trim(),
        definition: form.querySelector('[name="definition"]').value.trim(),
        pass_headers: form.querySelector('[name="pass_headers"]').checked || '',
        headers: (() => {
          let keys = form.querySelectorAll('[name="header-key"]')
          let vals = form.querySelectorAll('[name="header-val"]')
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
    .merge(
      MAIN.select('form button.delete').events('click')
        .tap(e => e.preventDefault())
        .map(e => e.ownerTarget.parentNode)
        .map(form => ({
          method: 'DELETE',
          url: `/e/${form.querySelector('[name="identifier"]').value}/`
        }))
    )

  let fetchList$ = match$
    .filter(m => m.value.where === 'ENDPOINTS' || m.value.where === 'ENDPOINT')
    .map(() => ({url: '/e/'}))

  let sel = 'a[href^="#/"]'
  let href$ = most.merge(MAIN.select(sel).events('click'), NAV.select(sel).events('click'))
    .map(e => e.target.getAttribute('href').slice(1))

  let request$ = hold(
    most.empty()
      .merge(endpointRequest$)
      .merge(fetchList$)
  )

  return {
    MAIN: vtree$,
    NAV: nav$,
    HTTP: request$
      .tap(x => console.log('pre request'))
      .sample((req, session) => {
        if (session && session.jwt) req.headers = {'Authorization': `Bearer ${session.jwt}`}
        return req
      }, request$, session$)
      .tap(x => console.log('post request'))
      .tap(req => req.url = API_ENDPOINT + req.url),
    ROUTER: most.empty()
      .merge(href$)
      .merge(created$.map(c => `/endpoints/${c.identifier}`))
      .merge(deleted$.constant('/endpoints'))
      .merge(hold(session$.filter(({jwt}) => jwt).constant('/endpoints')))
      .merge(hold(session$.filter(({jwt}) => !jwt).constant('/')))
      .skipRepeats()
      .multicast(),
    STORAGE: session$
      .map(session => STORAGE.setItem('session', JSON.stringify(session)))
      .merge(
        match$
          .filter(m => m.value.where === 'LOGOUT')
          .constant(STORAGE.removeItem('session'))
      )
      .merge(most.of(STORAGE.getItem('session')).delay(1)),
    PUSHER: match$
      .filter(m => m.value.where === 'ENDPOINT')
      .map(m => m.value.id),
    HEADER: session$
  }
}
