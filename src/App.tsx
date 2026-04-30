/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Whiteboard } from './components/Whiteboard';
import { nanoid } from 'nanoid';

export default function App() {
  const [boardId, setBoardId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let id = params.get('board');
    if (!id) {
      id = nanoid(10);
      window.history.replaceState({}, '', `?board=${id}`);
    }
    setBoardId(id);
  }, []);

  if (!boardId) return <div className="h-screen bg-gray-50 flex items-center justify-center">Initializing...</div>;

  return (
    <div id="whiteboard-root">
      <Whiteboard boardId={boardId} />
    </div>
  );
}
