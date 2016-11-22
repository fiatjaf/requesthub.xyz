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
  let deleted$ = response$
    .filter(r => r.deleteEndpoint)
    .map(r => r.deleteEndpoint)
  let endpoint$ = response$
    .filter(r => r.endpoint)
    .map(r => r.endpoint)
  let endpoints$ = response$
    .filter(r => r.endpoints)
    .map(r => r.endpoints)
    .merge(endpoint$)
    .merge(deleted$.map(({id}) => ({deleted: id})))
    .scan((map, cur) => {
      if (Array.isArray(cur)) {
        for (let i = 0; i < cur.length; i++) {
          map[cur[i].id] = cur[i]
        }
      } else if (cur.id) {
        map[cur.id] = cur
      } else if (cur.deleted) {
        delete map[cur.deleted]
      }
      return map
    }, {})
    .multicast()

  let selectedEndpointId$ = match$
    .filter(m => m.value.where === 'ENDPOINT')
    .map(m => m.value.id)

  let selectedEndpoint$ = most.combine(
    (endpointId, endpoints) => endpoints[endpointId],
    selectedEndpointId$,
    endpoints$.tap(x => console.log('all', x))
  )
    .tap(x => console.log('selected', x))

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
    .multicast()

  let pusherEvents$ = PUSHER.event$
    .map(ev => [ev.id, ev.data, 'pusher'])
    .scan((events, ev) => {
      events.unshift(ev)
      return events
    }, [])

  let endpointEvents$ = most.combine(
    (endpoint, pusherEvents) =>
      pusherEvents
        .filter(([id]) => id = endpoint.id)
        .map(([_, data]) => eval('(' + data + ')'))
        .concat(
          (endpoint && endpoint.recentEvents || [])
            .map(data => JSON.parse(data))
        )
    ,
    selectedEndpoint$
      .tap(x => console.log('this', x)),
    pusherEvents$
  )
    .startWith([])
    .thru(hold)

  let vtree$ = most.combine(
    (match, endpoints, nheaders, events, showingEvents, selectedEvent) =>
      fwitch(match.value.where, {
        CREATE: vrender.create.bind(null, nheaders),
        ENDPOINTS: vrender.list.bind(null, endpoints),
        ENDPOINT: endpoints[match.value.id] ? vrender.endpoint.bind(
          null,
          endpoints[match.value.id],
          nheaders,
          events,
          showingEvents,
          selectedEvent
        ) : vrender.empty,
        default: vrender.empty
      })
    ,
    match$,
    endpoints$,
    nheaders$,
    endpointEvents$.combine((ee, _) => ee, most.periodic(8000, 'x')),
    showEvents$,
    selectedEvent$
  )

  let replayEvent$ = DOM.select('.replay').events('click')
    .tap(e => e.preventDefault())
    .throttle(800)
    .sample(
      (id, selectedEvent, events, _) => {
        for (let i = 0; i < events.length; i++) {
          if (events[i].in.time.toString() === selectedEvent) {
            return [id, i]
          }
        }
      },
      selectedEndpointId$,
      selectedEvent$,
      endpointEvents$
    )

  let setEndpointGQL$ = DOM.select('form button.set').events('click')
    .tap(e => e.preventDefault())
    .map(e => e.ownerTarget.parentNode.parentNode.parentNode)
    .map(form => ({
      mutation: 'setEndpoint',
      variables: {
        currentId: form.querySelector('[name="current_id"]')
          ? form.querySelector('[name="current_id"]').value
          : undefined,
        id: form.querySelector('[name="identifier"]').value,
        description: form.querySelector('[name="description"]').value,
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
        .filter(() => window.confirm('Are you sure you want to delete this endpoint?'))
        .map(e => e.ownerTarget.parentNode.parentNode.parentNode)
        .map(form => ({
          mutation: 'deleteEndpoint',
          variables: {id: form.querySelector('[name="identifier"]').value}
        }))
    )

  let fetchEndpointsGQL$ = match$
    .filter(m => m.value.where === 'ENDPOINTS')
    .constant({query: 'fetchAll', forceFetch: true})

  let fetchEndpointGQL$ = selectedEndpointId$
    .map(id => ({
      query: 'fetchOne',
      variables: {
        id
      },
      forceFetch: true
    }))

  let replayEventGQL$ = replayEvent$
    .map(([id, index]) => ({
      mutation: 'replayEvent',
      variables: {
        id, index
      }
    }))

  let gql$ = most.merge(
    setEndpointGQL$,
    fetchEndpointsGQL$,
    fetchEndpointGQL$,
    replayEventGQL$
  ).thru(hold)

  let notification$ = most.merge(
    created$.map(({setEndpoint: s}) => [`<b>${s.id}</b> saved`, 'success', {timeout: 3000}]),
    deleted$.map(({id}) => [`<b>${id}</b> deleted`, {timeout: 4000}]),
    userError$.map(err => [err, 'error']),
    PUSHER.event$.map(({id}) => [`detected webhook call on <b>${id}</b>`, 'info',
                                 {timeout: 3000}]),
    most.from((() => {
      var messages = []
      let divs = document.querySelectorAll('.flashed-messages .alert')
      for (let i = 0; i < divs.length; i++) {
        messages.push([divs[i].innerHTML, 'error'])
      }
      document.querySelector('.flashed-messages').style.display = 'none'
      return messages
    })())
  )

  return {
    DOM: vtree$,
    GRAPHQL: gql$,
    ROUTER: most.empty()
      .merge(created$.map(({setEndpoint: s}) => `/endpoints/${s.id}`))
      .merge(deleted$.constant('/endpoints'))
      .skipRepeats()
      .multicast(),
    PUSHER: selectedEndpointId$
      .tap(x => console.log('PUSHER SUBSCRIBE', x)),
    NOTIFICATION: notification$
  }
}
