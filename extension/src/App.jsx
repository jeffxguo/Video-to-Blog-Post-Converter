/* global chrome */
import { useState, useEffect } from 'react'
import './index.css'

function App() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('idle') // idle, loading, complete, error
  const [content, setContent] = useState(null)
  const [error, setError] = useState(null)

  // 1. Initialize: Check storage for existing state & Get active tab URL
  useEffect(() => {
    // Clear badge when popup opens
    chrome.action.setBadgeText({ text: '' })

    // Check if we have a running job or result
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['status', 'content', 'error'], (result) => {
        if (result.status) setStatus(result.status)
        if (result.content) setContent(result.content)
        if (result.error) setError(result.error)
      })

      // Listen for changes in storage (real-time updates from background)
      const listener = (changes) => {
        if (changes.status) setStatus(changes.status.newValue)
        if (changes.content) setContent(changes.content.newValue)
        if (changes.error) setError(changes.error.newValue)
      }
      chrome.storage.onChanged.addListener(listener)
      return () => chrome.storage.onChanged.removeListener(listener)
    }
  }, [])

  // Get URL only if we are idle
  useEffect(() => {
    if (status === 'idle' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0]
        if (currentTab?.url?.includes('youtube.com/watch')) {
          setUrl(currentTab.url)
        }
      })
    }
  }, [status])

  const handleGenerate = () => {
    if (!url) return
    setStatus('loading')
    setError(null)

    // Send message to background script to start work
    chrome.runtime.sendMessage({ action: 'START_GENERATION', url })
  }

  const handleReset = () => {
    // Clear storage to reset UI
    chrome.storage.local.set({ status: 'idle', content: null, error: null })
    setStatus('idle')
    setContent(null)
    setError(null)
  }

  const generateFullHtml = (data) => {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${data.title}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
            background-color: #f9fafb;
          }
          header {
            margin-bottom: 40px;
            text-align: center;
          }
          h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            color: #111;
            letter-spacing: -0.02em;
          }
          .summary-box {
            background: #fff;
            border-left: 4px solid #6366f1;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            margin-bottom: 40px;
            font-style: italic;
            color: #555;
          }
          .content {
            background: #fff;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
          }
          .content h2 { margin-top: 1.5em; color: #1f2937; }
          .content p { margin-bottom: 1.2em; }
          .content ul { margin-bottom: 1.2em; padding-left: 20px; }
          .content li { margin-bottom: 0.5em; }
          a { color: #6366f1; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <header>
          <h1>${data.title}</h1>
        </header>
        
        <div class="summary-box">
          <strong>Summary:</strong> ${data.summary_for_card}
        </div>

        <div class="content">
          ${data.content_html}
        </div>
      </body>
      </html>
    `
  }

  const handleOpenNewTab = () => {
    if (!content) return
    const fullHtml = generateFullHtml(content)
    const file = new Blob([fullHtml], { type: 'text/html' })
    const fileURL = URL.createObjectURL(file)
    chrome.tabs.create({ url: fileURL })
  }

  // --- UI RENDER ---

  if (status === 'loading') {
    return (
      <div className="w-[350px] min-h-[450px] bg-gradient-to-br from-slate-900 to-slate-800 text-white flex flex-col items-center justify-center p-8">
        <div className="relative w-20 h-20 mb-8">
          <div className="absolute inset-0 border-4 border-indigo-500/30 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-indigo-500 rounded-full border-t-transparent animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
          </div>
        </div>
        <h2 className="text-2xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-indigo-200 to-white">Generating...</h2>
        <p className="text-slate-400 text-center text-sm leading-relaxed">
          The AI is watching the video and writing your post.
          <br />
          <span className="text-indigo-400 font-medium mt-2 block">You can close this popup.</span>
        </p>
      </div>
    )
  }

  if (status === 'complete' && content) {
    return (
      <div className="w-[350px] min-h-[450px] bg-slate-50 flex flex-col font-sans">
        {/* Header */}
        <div className="bg-white px-5 py-4 shadow-sm border-b border-slate-200 flex justify-between items-center sticky top-0 z-10">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            <h3 className="font-bold text-slate-800 text-sm uppercase tracking-wide">Result Ready</h3>
          </div>
          <button
            onClick={handleReset}
            className="text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors px-2 py-1 rounded hover:bg-slate-100"
          >
            Start Over
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 flex flex-col overflow-y-auto">
          <h2 className="text-xl font-bold text-slate-900 leading-tight mb-4">
            {content.title}
          </h2>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 relative group hover:shadow-md transition-shadow">
            <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500 rounded-l-xl"></div>
            <p className="text-sm text-slate-600 line-clamp-4 leading-relaxed pl-2">
              {content.summary_for_card}
            </p>
          </div>

          {/* Actions */}
          <div className="mt-auto space-y-3">
            <button
              onClick={handleOpenNewTab}
              className="w-full group flex items-center justify-center py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-semibold transition-all shadow-lg shadow-indigo-200 hover:shadow-indigo-300 transform hover:-translate-y-0.5"
            >
              <svg className="w-5 h-5 mr-2.5 text-indigo-100 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
              Read Full Post
            </button>

            <button
              onClick={() => {
                const element = document.createElement("a")
                const fullHtml = generateFullHtml(content)
                const file = new Blob([fullHtml], { type: 'text/html' })
                element.href = URL.createObjectURL(file)
                element.download = "blog-post.html"
                element.click()
              }}
              className="w-full group flex items-center justify-center py-3 px-4 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700 font-medium transition-all"
            >
              <svg className="w-5 h-5 mr-2.5 text-slate-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
              Download HTML
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-[350px] min-h-[450px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col p-6 font-sans">
      <div className="mb-10 mt-6 text-center">
        <div className="w-14 h-14 bg-gradient-to-tr from-indigo-500 to-violet-500 rounded-2xl flex items-center justify-center mb-5 mx-auto shadow-xl shadow-indigo-500/20 transform rotate-3">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
          YouTube to Blog
        </h1>
        <p className="text-slate-400 text-sm mt-2 font-medium">Transform videos into articles instantly.</p>
      </div>

      <div className="space-y-5">
        <div>
          <label className="block text-xs font-bold text-indigo-400 uppercase tracking-widest mb-2 ml-1">
            Video URL
          </label>
          <div className="relative">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/..."
              className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3.5 pl-10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-inner"
            />
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={!url}
          className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-xl shadow-lg shadow-indigo-900/40 transition-all transform hover:-translate-y-0.5 active:scale-[0.98] mt-4 flex items-center justify-center space-x-2"
        >
          <span>Generate Blog Post</span>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
        </button>
      </div>

      {error && (
        <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start space-x-3">
          <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          <p className="text-red-400 text-xs leading-relaxed">{error}</p>
        </div>
      )}
    </div>
  )
}

export default App
