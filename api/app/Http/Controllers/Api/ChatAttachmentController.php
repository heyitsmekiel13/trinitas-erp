<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\User;
use App\Services\ChatService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Sending and fetching what is attached to a message.
 *
 * Kept apart from ChatController because uploads are a different shape of
 * problem: multipart rather than JSON, a disk to write to, and a download
 * route that has to re-authorise on every request rather than once when the
 * conversation opened.
 *
 * Files live on the private disk. Nothing is written under `public/`, because
 * anything there is readable by whoever guesses the path — and half of what
 * gets pasted into a work chat is a photograph of a document.
 */
class ChatAttachmentController extends Controller
{
    /** Ten megabytes. Enough for a phone photo or a short clip, not a video call recording. */
    private const MAX_KILOBYTES = 10_240;

    public function __construct(private readonly ChatService $chat) {}

    /**
     * Posts a message carrying files.
     *
     * The body is optional here, unlike an ordinary send — "here you go" with
     * three photos is a complete message, and forcing a caption just gets a
     * full stop typed into the box.
     */
    public function store(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $this->member($request, $conversation);

        $data = $request->validate([
            'body' => 'nullable|string|max:4000',
            'replyToId' => 'nullable|integer|exists:messages,id',
            'files' => 'required|array|min:1|max:10',
            'files.*' => 'file|max:'.self::MAX_KILOBYTES,
        ]);

        if (! empty($data['replyToId'])) {
            $parent = Message::find($data['replyToId']);
            if (! $parent || $parent->conversation_id !== $conversation->id) {
                return response()->json(['message' => 'You can only reply to a message in this conversation.'], 422);
            }
        }

        $message = $this->chat->send(
            $me,
            $conversation,
            trim((string) ($data['body'] ?? '')),
            $data['replyToId'] ?? null,
        );

        foreach ($request->file('files', []) as $file) {
            $mime = $file->getMimeType();
            $kind = MessageAttachment::kindFor($mime);

            $path = $file->store("chat/{$conversation->id}", 'local');

            /* Dimensions are read once, here, so the bubble can reserve the
               right space before the image arrives instead of jolting the
               whole thread downward when it does. */
            [$width, $height] = $kind === 'image'
                ? (@getimagesize($file->getRealPath()) ?: [null, null])
                : [null, null];

            MessageAttachment::create([
                'message_id' => $message->id,
                'conversation_id' => $conversation->id,
                'user_id' => $me->id,
                'kind' => $kind,
                'disk_path' => $path,
                'original_name' => $file->getClientOriginalName(),
                'mime' => $mime,
                'bytes' => $file->getSize(),
                'width' => $width ?: null,
                'height' => $height ?: null,
            ]);
        }

        return response()->json([
            'data' => $this->chat->present($message->fresh(), $me),
        ], 201);
    }

    /**
     * Streams one attachment back.
     *
     * Reached on a signed URL rather than a bearer token, because an <img>
     * cannot send an Authorization header. There is therefore no signed-in
     * user to check here — the signature is the credential, and it was minted
     * in `MessageAttachment::getUrlAttribute` only for a request that had
     * already passed the membership check on the conversation.
     */
    public function show(MessageAttachment $attachment): StreamedResponse
    {
        abort_unless(Storage::disk('local')->exists($attachment->disk_path), 404, 'That file is no longer here.');

        // Images and clips are shown in place; anything else downloads under
        // the name it was sent with rather than a hash from the disk.
        $inline = in_array($attachment->kind, ['image', 'video', 'audio'], true);

        return Storage::disk('local')->response(
            $attachment->disk_path,
            $attachment->original_name,
            ['Content-Type' => $attachment->mime ?: 'application/octet-stream'],
            $inline ? 'inline' : 'attachment',
        );
    }

    private function member(Request $request, ?Conversation $conversation): User
    {
        /** @var User $me */
        $me = $request->user();

        if (! $conversation || ! $this->chat->isMember($me, $conversation)) {
            abort(404, 'Conversation not found.');
        }

        return $me;
    }
}
