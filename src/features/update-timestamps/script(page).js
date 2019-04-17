import select from 'select-dom'
import requireFanfouLib from '@libs/requireFanfouLib'
import safeElementReady from '@libs/safeElementReady'
import every from '@libs/promiseEvery'

const INTERVAL_DURATION = 15 * 1000

export default () => {
  let intervalId

  function updateTimestamps() {
    const timeElements = select.all('#stream > ol > li > .stamp > .time')

    for (const element of timeElements) {
      const time = (
        window.FF.util.parseDate(element.getAttribute('stime')) +
        window.FF.app.Timeline.srv_clk_minus_client
      )

      element.textContent = window.FF.util.getRelativeTime(time)
    }
  }

  return {
    applyWhen: () => safeElementReady('#stream'),

    waitReady: () => every([
      requireFanfouLib('FF.util.parseDate'),
      requireFanfouLib('FF.util.getRelativeTime'),
    ]),

    onLoad() {
      intervalId = setInterval(updateTimestamps, INTERVAL_DURATION)
    },

    onUnload() {
      clearInterval(intervalId)
      intervalId = null
    },
  }
}
