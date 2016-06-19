import humane from 'humane-js'
import loadCSS from 'loads-css'

export function makeNotificationDriver (opts = {}) {
  loadCSS('https://cdnjs.cloudflare.com/ajax/libs/humane-js/3.2.2/humane.min.js', noop)

  opts.timeout = opts.timeout || 7000
  opts.baseCls = opts.baseCls || 'humane-flatty'

  loadCSS('https://cdnjs.cloudflare.com/ajax/libs/humane-js/3.2.2/themes/' + opts.baseCls.split('-')[1] + '.min.css', noop)

  const notifier = humane.create(opts)

  return function notificationDriver (notification$) {
    notification$.observe(notification => {
      if (typeof notification === 'string') {
        notifier.log(notification)
      } else if (Array.isArray(notification)) {
        var localOpts

        if (typeof notification[1] === 'string') {
          localOpts = notification[2] || {}
          localOpts.addnCls = opts.baseCls + '-' + notification[1]
        } else {
          localOpts = notification[1]
        }

        notifier.log(notification[0], localOpts)
      } else if (typeof notification === 'object') {
        notifier.log(notification.text, notification)
      }
    })
  }
}

function noop () {}
