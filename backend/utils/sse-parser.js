/**
 * SSE 流解析器
 * 解析 HTTP 响应流中的 Server-Sent Events 数据
 */

/**
 * 解析 SSE 流数据
 * @param {Stream} stream - Node.js 可读流（axios responseType: 'stream' 的响应）
 * @param {Function} onMessage - 每解析到一条 JSON 消息时的回调
 * @returns {Promise<void>}
 */
function processSSEStream(stream, onMessage) {
    return new Promise((resolve, reject) => {
        let buffer = '';

        stream.on('data', (chunk) => {
            buffer += chunk.toString();

            // SSE 数据以双换行符分隔事件
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 保留最后不完整的行

            for (const line of lines) {
                const trimmed = line.trim();

                if (!trimmed) continue;
                if (trimmed.startsWith(':')) continue; // SSE 注释

                if (trimmed.startsWith('data:')) {
                    const data = trimmed.slice(5).trim();

                    if (data === '[DONE]') {
                        resolve();
                        return;
                    }

                    try {
                        const parsed = JSON.parse(data);
                        onMessage(parsed);
                    } catch (e) {
                        // 忽略无法解析的行（如心跳/注释）
                    }
                }
            }
        });

        stream.on('end', () => {
            // 处理 buffer 中剩余的数据
            if (buffer.trim()) {
                const trimmed = buffer.trim();
                if (trimmed.startsWith('data:')) {
                    const data = trimmed.slice(5).trim();
                    if (data !== '[DONE]') {
                        try {
                            const parsed = JSON.parse(data);
                            onMessage(parsed);
                        } catch (e) { /* 忽略 */ }
                    }
                }
            }
            resolve();
        });

        stream.on('error', (err) => {
            reject(err);
        });
    });
}

module.exports = { processSSEStream };
