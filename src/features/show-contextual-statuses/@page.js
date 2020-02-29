import { h, Component } from 'preact'
import wretch from 'wretch'
import select from 'select-dom'
import cx from 'classnames'
import arrayLast from 'array-last'
import sleep from 'p-sleep'
import { CLASSNAME_CONTAINER } from './constants'
import { isTimelinePage } from '@libs/pageDetect'
import requireFanfouLib from '@libs/requireFanfouLib'
import preactRender from '@libs/preactRender'
import extractText from '@libs/extractText'
import { fadeOut } from '@libs/fade'
import isStatusElement from '@libs/isStatusElement'
import isElementInDocument from '@libs/isElementInDocument'
import every from '@libs/promiseEvery'

// 表示这条消息可以展开上下文，主要用于辅助 CSS
const ATTRIBUTE_STATUS_WITH_CONTEXT = 'sf-contextual-statuses'

export default context => {
  const { readOptionValue, requireModules, elementCollection } = context
  const { timelineElementObserver } = requireModules([ 'timelineElementObserver' ])

  const instanceMap = new WeakMap()

  elementCollection.add({
    stream: '#stream',
  })

  class ContextualStatus extends Component {
    render() {
      const { isLast } = this.props

      return (
        <li className={cx('unlight', { 'sf-last': isLast })} />
      )
    }

    componentDidMount() {
      const li = this.base

      // 在这里而不是在 render 里使用 dangerouslySetInnerHTML，可以避免闪烁
      li.innerHTML = this.props.html

      window.FF.app.Stream.attach(li)

      if (this.props.hasPhoto) {
        window.FF.app.Zoom.init(li)
      }
    }
  }

  class ContextualStatuses extends Component {
    constructor(props) {
      super(props)

      this.initialState = {
        hasMore: true,
        pendingNumber: 0,
        nextStatusId: props.initialStatusId,
        unavailableReason: '',
        isWaiting: false,
        statuses: [],
      }

      this.state = { ...this.initialState }
    }

    async fetchNextNStatuses(pendingNumber) {
      this.setState(() => ({ pendingNumber }))

      if (pendingNumber > 0 && this.state.hasMore) {
        await this.fetchNextStatus()
        await sleep(400)

        this.fetchNextNStatuses(pendingNumber - 1)
      }
    }

    fetchNextNStatusesPerConfig = () => {
      this.fetchNextNStatuses(readOptionValue('fetchStatusNumberPerClick'))
    }

    resetState = () => {
      this.setState(this.initialState)
    }

    fetchNextStatus = async () => {
      this.setState({ isWaiting: true })

      const statusPageHtml = await fetchStatusPageHtml(this.state.nextStatusId)
      const { statusHtml, unavailableReason, nextStatusId, hasPhoto } = processStatusPageHtml(statusPageHtml)

      if (unavailableReason) {
        this.setState({
          hasMore: false,
          unavailableReason,
        })
      } else {
        this.setState(state => ({
          hasMore: !!nextStatusId,
          nextStatusId,
          statuses: [ ...state.statuses, {
            isLast: !nextStatusId,
            html: statusHtml,
            hasPhoto,
          } ],
        }))
      }

      this.setState({ isWaiting: false })
    }

    renderToggle() {
      if (!this.state.hasMore && !this.state.statuses.length) {
        return null
      }

      if (this.state.isWaiting && !this.state.statuses.length) {
        return null
      }

      if (this.state.statuses.length) {
        return (
          <button className="sf-toggle sf-animation-off" onClick={this.resetState}>
            隐藏原文
          </button>
        )
      }

      const text = this.props.type === 'repost'
        ? '转自'
        : '展开'

      return (
        <button className={`sf-toggle sf-${this.props.type}`} onClick={this.fetchNextNStatusesPerConfig}>
          { text }
        </button>
      )
    }

    renderStatuses() {
      return (
        <div className="sf-contextual-statuses">
          { this.state.statuses.map((props, i) => <ContextualStatus key={i} {...props} />) }
        </div>
      )
    }

    renderIndicator() {
      if (this.state.isWaiting && this.state.pendingNumber > 0) {
        return (
          <button className="sf-indicator sf-waiting sf-animation-off" />
        )
      }

      if (!this.state.hasMore && this.state.unavailableReason) {
        return (
          <button className="sf-indicator sf-not-available">{ this.state.unavailableReason }</button>
        )
      }

      if (this.state.hasMore && this.state.statuses.length) {
        return (
          <button className="sf-indicator" onClick={this.fetchNextNStatusesPerConfig}>继续展开</button>
        )
      }
    }

    render() {
      return (
        <div className={CLASSNAME_CONTAINER}>
          { this.renderToggle() }
          { this.renderStatuses() }
          { this.renderIndicator() }
        </div>
      )
    }

    componentDidMount() {
      if (readOptionValue('autoFetch')) {
        this.fetchNextStatus()
      }
    }
  }

  function fetchStatusPageHtml(statusId) {
    return wretch(`/statuses/${statusId}`).get().text()
  }

  function processStatusPageHtml(statusPageHtml) {
    const { avatar, author, other } = extractText(statusPageHtml, [
      { key: 'avatar', opening: '<div id="avatar">', closing: '</div>' },
      { key: 'author', opening: '<h1>', closing: '</h1>' },
      { key: 'other', opening: /<h2( class="deleted")?>/, closing: '</h2>' },
    ])
    const statusHtml = (
      avatar.replace('<a', '<a class="avatar"') +
      author.replace('<a', '<a class="author"') +
      other.replace(' redirect="/home"', '') // 删除按钮带有这个 attribute
    )
    let unavailableReason
    let nextStatusId
    let hasPhoto = false

    if (other.includes('我只向关注我的人公开我的消息')) {
      unavailableReason = '未公开'
    } else if (other.includes('此消息已被删除')) {
      unavailableReason = '已删除'
    } else {
      nextStatusId = other.match(/<span class="reply"><a href="\/statuses\/(.+?)">.+<\/a><\/span>/)?.[1]
      hasPhoto = other.includes('<img ')
    }

    return { statusHtml, unavailableReason, nextStatusId, hasPhoto }
  }

  function hasContextualStatuses(li) {
    return select.exists('.stamp .reply a', li)
  }

  function onStatusAdded(li) {
    // 被删除的可能是我们插入进去的 `sf-contextual-statuses-container`
    if (!isStatusElement(li)) return
    // 必须是回复或转发消息，否则忽略
    if (!hasContextualStatuses(li)) return

    li.setAttribute(ATTRIBUTE_STATUS_WITH_CONTEXT, '')

    const replyLink = select('.stamp .reply a', li)
    const props = {
      type: replyLink.textContent.startsWith('转自')
        ? 'repost'
        : 'reply',
      initialStatusId: arrayLast(replyLink.href.split('/')),
    }

    preactRender(<ContextualStatuses {...props} />, instance => {
      // 调整插入位置
      li.after(instance)
      instanceMap.set(li, instance)
    })
  }

  async function onStatusRemoved(li) {
    if (!isStatusElement(li)) return
    if (!hasContextualStatuses(li)) return

    const instance = instanceMap.get(li)

    if (instance) {
      const elements = select.all('button, li', instance)

      // 如果已经不存在于 DOM 中，则不需要出场动画等操作
      if (isElementInDocument(instance)) {
        // 按钮、展开的消息按顺序逐一播放淡出动画
        while (elements.length) {
          const element = elements.shift()

          await fadeOut(element, 400)
          element.remove()
        }

        // 动画结束后，删除最外层容器
        instance.remove()
      }

      instanceMap.delete(li)
    }
  }

  function mutationObserverCallback(mutationRecords) {
    for (const { addedNodes, removedNodes } of mutationRecords) {
      for (const addedNode of addedNodes) {
        onStatusAdded(addedNode)
      }

      for (const removedNode of removedNodes) {
        onStatusRemoved(removedNode)
      }
    }
  }

  return {
    applyWhen: () => isTimelinePage(),

    waitReady: () => every([
      requireFanfouLib('jQuery'),
      requireFanfouLib('FF.app.Stream'),
      requireFanfouLib('FF.app.Zoom'),
    ]),

    onLoad() {
      timelineElementObserver.addCallback(mutationObserverCallback)
    },

    onUnload() {
      timelineElementObserver.removeCallback(mutationObserverCallback)

      for (const li of select.all(`[${ATTRIBUTE_STATUS_WITH_CONTEXT}]`)) {
        li.removeAttribute(ATTRIBUTE_STATUS_WITH_CONTEXT)
      }

      for (const container of select.all(`.${CLASSNAME_CONTAINER}`)) {
        container.remove()
      }
    },
  }
}
