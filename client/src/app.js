import most from 'most'
import hold from '@most/hold'
import fwitch from 'fwitch'

import * as vrender from './vrender'

export default function main ({DOM, GRAPHQL, ROUTER, PUSHER}) {
  let match$ = ROUTER.define({
    '/': {where: 'ENDPOINTS'},
    '/create': {where: 'CREATE'},
    '/account': {where: 'ACCOUNT'},
    '/endpoints': {where: 'ENDPOINTS'},
    '/endpoints/:endpoint': id => ({where: 'ENDPOINT', id})
  })
    .thru(hold)

  let response$ = GRAPHQL
    .flatMap(r$ => r$
      .recoverWith(err =>
        console.log('got err', err) || most.of({errors: [err.message]})
      )
    )
    .filter(({errors}) => {
      if (errors && errors.length) {
        console.log('errors:', errors)
        return false
      }
      return true
    })
    .map(({data}) => data)

  let userError$ = response$
    .map(data => data[Object.keys(data)[0]])
    .filter(fields => fields.error)
    .map(fields => fields.error)

  let created$ = response$
    .filter(r => r.setEndpoint && r.setEndpoint.ok)
  let deleted$ = response$.filter(r => r.deleteEndpoint)
  let endpoint$ = response$
    .filter(r => r.endpoint)
    .map(r => r.endpoint)
  let endpoints$ = response$
    .filter(r => r.endpoints)
    .map(r => r.endpoints)
    .merge(endpoint$)
    .scan((map, cur) => {
      if (Array.isArray(cur)) {
        for (let i = 0; i < cur.length; i++) {
          map[cur[i].id] = cur[i]
        }
      } else {
        map[cur.id] = cur
      }
      return map
    }, {})

  let nheaders$ = most.merge(
    DOM.select('.a-header').events('click').tap(e => e.preventDefault()).constant(1),
    DOM.select('.r-header').events('click').tap(e => e.preventDefault()).constant(-1)
  )
    .scan((acc, v) => (acc + v) || 1, 2)

  let showEvents$ = most.merge(
    DOM.select('.s-events').events('click').tap(e => e.preventDefault()).constant(true),
    DOM.select('.h-events').events('click').tap(e => e.preventDefault()).constant(false)
  )
    .startWith(false)

  let selectedEvent$ = DOM.select('tr.event').events('click')
    .map(e => e.ownerTarget.id.slice(3)) // id="ev-{ timestring }"
    .scan((cur, next) => cur === next ? null : next, null)

  let events$ = PUSHER.event$
    .map(ev => [ev.id, ev.data])
    .scan((events, ev) => {
      events.unshift(ev)
      return events
    }, [])

  let vtree$ = most.combine(
    (match, endpoints, nheaders, events, showingEvents, selectedEvent, _) =>
      fwitch(match.value.where, {
        CREATE: vrender.create.bind(null, nheaders),
        ENDPOINTS: vrender.list.bind(null, endpoints),
        ENDPOINT: vrender.endpoint.bind(
          null,
          endpoints[match.value.id],
          nheaders,
          events,
          showingEvents,
          selectedEvent
        ),
        default: vrender.empty
      })
    ,
    match$,
    endpoints$,
    nheaders$,
    events$,
    showEvents$,
    selectedEvent$,
    DOM.select('button.flush').events('click')
      .tap(e => e.preventDefault())
      .startWith(null)
  )

  let endpointGQL$ = DOM.select('form button.set').events('click')
    .tap(e => e.preventDefault())
    .map(e => e.ownerTarget.parentNode)
    .map(form => ({
      mutation: 'setEndpoint',
      variables: {
        currentId: form.querySelector('[name="current_id"]')
          ? form.querySelector('[name="current_id"]').value
          : undefined,
        id: form.querySelector('[name="identifier"]').value,
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
          return JSON.stringify(headers)
        })()
      }
    }))
    .merge(
      DOM.select('form button.delete').events('click')
        .tap(e => e.preventDefault())
        .map(e => e.ownerTarget.parentNode)
        .map(form => ({
          mutation: 'deleteEndpoint',
          variables: {id: form.querySelector('[name="identifier"]').value}
        }))
    )

  let fetchEndpointsGQL$ = match$
    .filter(m => m.value.where === 'ENDPOINTS')
    .constant({query: 'fetchAll', forceFetch: true})

  let fetchEndpointGQL$ = match$
    .filter(m => m.value.where === 'ENDPOINT')
    .map(m => ({
      query: 'fetchOne',
      variables: {
        id: m.value.id
      },
      forceFetch: true
    }))

  let gql$ = most.merge(
    endpointGQL$,
    fetchEndpointsGQL$,
    fetchEndpointGQL$
  ).thru(hold)

  let notification$ = most.merge(
    created$.map(({setEndpoint: s}) => [`<b>${s.id}</b> saved`, 'success', {timeout: 3000}]),
    deleted$.constant(['endpoint deleted', {timeout: 4000}]),
    userError$.map(err => [err, 'error']),
    PUSHER.event$.map(({id}) => [`detected webhook call on <b>${id}</b>`, 'info', {timeout: 3000}])
  )

  return {
    DOM: vtree$,
    GRAPHQL: gql$,
    ROUTER: most.empty()
      .merge(created$.map(({setEndpoint: s}) => `/endpoints/${s.id}`))
      .merge(deleted$.constant('/endpoints'))
      .skipRepeats()
      .multicast(),
    PUSHER: match$
      .filter(m => m.value.where === 'ENDPOINT')
      .map(m => m.value.id)
      .tap(x => console.log('PUSHER SUBSCRIBE', x)),
    NOTIFICATION: notification$
  }
}
