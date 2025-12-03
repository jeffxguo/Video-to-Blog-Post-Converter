/* global chrome */
// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_GENERATION') {
        handleGeneration(request.url);
    }
});

async function handleGeneration(url) {
    // 1. Set state to loading
    await chrome.storage.local.set({
        status: 'loading',
        error: null,
        content: null
    });

    // Set loading badge
    chrome.action.setBadgeText({ text: '...' });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' }); // Indigo

    try {
        // Hardcoded Cloud Run URL
        const apiUrl = 'https://backend-343822908842.us-central1.run.app';

        const response = await fetch(`${apiUrl}/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Failed to generate content');
        }

        const data = await response.json();

        // 2. Save success result
        await chrome.storage.local.set({
            status: 'complete',
            content: data,
            error: null
        });

        // Set success badge
        chrome.action.setBadgeText({ text: 'DONE' });
        chrome.action.setBadgeBackgroundColor({ color: '#22c55e' }); // Green

        // 3. Notify user
        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon48.png'),
            title: 'Blog Post Ready!',
            message: `"${data.title}" has been generated. Click to view.`,
            priority: 2
        });

    } catch (err) {
        // 3. Save error state
        await chrome.storage.local.set({
            status: 'error',
            error: err.message,
            content: null
        });

        // Set error badge
        chrome.action.setBadgeText({ text: 'ERR' });
        chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Red
    }
}
