interface EventDisplayProps {
  events: Array<{
    id: string;
    timestamp: Date;
    type: string;
    content?: string;
    text?: string;
    direction: 'sent' | 'received';
  }>;
  maxEvents?: number;
  onClearEvents?: () => void;
}

export default function EventDisplay({ events, maxEvents = 50, onClearEvents }: EventDisplayProps) {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  };

  const getEventColor = (type: string, direction: 'sent' | 'received') => {
    if (direction === 'sent') {
      return 'bg-blue-50 border-blue-200 text-blue-800';
    }

    switch (type) {
      case 'response.text':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'response.audio':
        return 'bg-purple-50 border-purple-200 text-purple-800';
      case 'input_text':
        return 'bg-orange-50 border-orange-200 text-orange-800';
      case 'error':
        return 'bg-red-50 border-red-200 text-red-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const getEventIcon = (type: string, direction: 'sent' | 'received') => {
    if (direction === 'sent') {
      return '↑';
    }

    switch (type) {
      case 'response.text':
        return '💬';
      case 'response.audio':
        return '🔊';
      case 'input_text':
        return '📝';
      case 'error':
        return '❌';
      default:
        return '📡';
    }
  };

  const displayEvents = events.slice(-maxEvents).reverse();

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">OpenAI Realtime Events</h3>
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2 text-xs text-gray-500">
            <span>Latest {displayEvents.length} events</span>
            {events.length > maxEvents && (
              <span className="bg-gray-100 px-2 py-1 rounded">
                {events.length - maxEvents}+ older
              </span>
            )}
          </div>
          {onClearEvents && events.length > 0 && (
            <button
              onClick={onClearEvents}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {displayEvents.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <div className="text-4xl mb-2">📡</div>
            <p className="text-sm">No events received yet</p>
            <p className="text-xs mt-1">Start a session to see OpenAI events</p>
          </div>
        ) : (
          displayEvents.map((event) => (
            <div
              key={event.id}
              className={`p-3 rounded-lg border ${getEventColor(event.type, event.direction)} transition-all duration-200 hover:shadow-sm`}
            >
              <div className="flex items-start space-x-3">
                <span className="text-lg flex-shrink-0">{getEventIcon(event.type, event.direction)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm capitalize">
                      {event.type.replace('.', ' ')}
                    </span>
                    <span className="text-xs opacity-70">
                      {formatTime(event.timestamp)}
                    </span>
                  </div>
                  {(event.content || event.text) && (
                    <p className="text-sm break-words">
                      {event.content || event.text}
                    </p>
                  )}
                  <div className="flex items-center mt-1 space-x-2">
                    <span className={`text-xs px-2 py-1 rounded ${
                      event.direction === 'sent'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {event.direction === 'sent' ? 'Sent to OpenAI' : 'Received from OpenAI'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}