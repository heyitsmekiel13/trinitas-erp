<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Getting a conversation out of the way.
 *
 * The property that matters most here is that archiving is *mine*. A thread I
 * put down has to stay exactly where it was in everybody else's list — the
 * moment one person's tidying removes another person's mail, the feature is
 * worse than not having it.
 *
 * The other two are restricted, and the restrictions are the test: only a
 * group can be left, and only a group's own admin can destroy one.
 */
class ConversationArchiveTest extends TestCase
{
    use RefreshDatabase;

    private User $me;

    private User $other;

    protected function setUp(): void
    {
        parent::setUp();

        $this->me = User::create([
            'name' => 'Juan Dela Cruz', 'email' => 'juan@example.com', 'password' => bcrypt('x'),
        ]);

        $this->other = User::create([
            'name' => 'Maria Santos', 'email' => 'maria@example.com', 'password' => bcrypt('x'),
        ]);

        Sanctum::actingAs($this->me);
    }

    private function room(string $kind = 'group', string $myRole = 'admin'): Conversation
    {
        $conversation = Conversation::create([
            'kind' => $kind,
            'name' => $kind === 'group' ? 'Ops huddle' : null,
            'last_message_at' => now(),
        ]);

        foreach ([[$this->me, $myRole], [$this->other, 'member']] as [$user, $role]) {
            ConversationParticipant::create([
                'conversation_id' => $conversation->id,
                'user_id' => $user->id,
                'role' => $role,
                'joined_at' => now(),
            ]);
        }

        return $conversation;
    }

    /* ------------------------------------------------------------------ */

    public function test_archiving_takes_it_off_my_list_only(): void
    {
        $room = $this->room();

        $this->postJson("/api/v1/chat/conversations/{$room->id}/archive")
            ->assertOk()
            ->assertJsonPath('data.archived', true);

        // Gone from mine.
        $this->getJson('/api/v1/chat/conversations')->assertJsonCount(0, 'data');

        // And still there, untouched, for the other person.
        Sanctum::actingAs($this->other);
        $this->getJson('/api/v1/chat/conversations')->assertJsonCount(1, 'data');
    }

    public function test_the_archive_is_a_separate_list(): void
    {
        $room = $this->room();

        $this->postJson("/api/v1/chat/conversations/{$room->id}/archive")->assertOk();

        $this->getJson('/api/v1/chat/conversations?archived=1')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $room->id);

        // The two lists never overlap.
        $this->getJson('/api/v1/chat/conversations')->assertJsonCount(0, 'data');
    }

    public function test_a_thread_comes_back_exactly_as_it_was(): void
    {
        $room = $this->room();

        $this->postJson("/api/v1/chat/conversations/{$room->id}/archive")->assertOk();
        $this->postJson("/api/v1/chat/conversations/{$room->id}/archive", ['archived' => false])
            ->assertOk()
            ->assertJsonPath('data.archived', false);

        $this->getJson('/api/v1/chat/conversations')->assertJsonCount(1, 'data');

        // Nothing was deleted and nothing was marked read on the way through.
        $this->assertSame(2, ConversationParticipant::where('conversation_id', $room->id)->count());
    }

    public function test_a_direct_conversation_cannot_be_left(): void
    {
        $room = $this->room('direct');

        $response = $this->postJson("/api/v1/chat/conversations/{$room->id}/leave");

        $response->assertStatus(422);
        // And the refusal names what to do instead, rather than just saying no.
        $this->assertStringContainsString('archive', mb_strtolower($response->json('message')));
    }

    public function test_a_department_room_cannot_be_left(): void
    {
        // Leaving would be undone by the next org-chart sync, so it is refused
        // rather than quietly reversed a day later.
        $room = $this->room('department');

        $this->postJson("/api/v1/chat/conversations/{$room->id}/leave")->assertStatus(422);
    }

    public function test_leaving_a_group_removes_only_me(): void
    {
        $room = $this->room();

        $this->postJson("/api/v1/chat/conversations/{$room->id}/leave")->assertOk();

        $this->assertSame(
            0,
            ConversationParticipant::where('conversation_id', $room->id)->where('user_id', $this->me->id)->count(),
        );
        $this->assertSame(
            1,
            ConversationParticipant::where('conversation_id', $room->id)->count(),
        );
    }

    public function test_only_a_group_admin_may_delete_for_everybody(): void
    {
        $room = $this->room('group', 'member');

        $response = $this->deleteJson("/api/v1/chat/conversations/{$room->id}");

        $response->assertStatus(422);
        $this->assertStringContainsString('admin', $response->json('message'));
        $this->assertNotNull(Conversation::find($room->id));
    }

    public function test_a_direct_conversation_may_never_be_deleted(): void
    {
        // It belongs as much to the other person as to me.
        $room = $this->room('direct');

        $this->deleteJson("/api/v1/chat/conversations/{$room->id}")->assertStatus(422);
        $this->assertNotNull(Conversation::find($room->id));
    }

    public function test_an_admin_deleting_a_group_removes_it_for_everybody(): void
    {
        $room = $this->room('group', 'admin');

        $this->deleteJson("/api/v1/chat/conversations/{$room->id}")->assertOk();

        $this->getJson('/api/v1/chat/conversations')->assertJsonCount(0, 'data');

        Sanctum::actingAs($this->other);
        $this->getJson('/api/v1/chat/conversations')->assertJsonCount(0, 'data');

        // Soft, so the messages survive for an audit and a mistake is
        // recoverable from the database.
        $this->assertNull(Conversation::find($room->id));
        $this->assertNotNull(Conversation::withTrashed()->find($room->id));
    }

    public function test_the_row_says_what_this_reader_may_do_to_it(): void
    {
        $group = $this->room('group', 'admin');
        $direct = $this->room('direct');

        $rows = collect($this->getJson('/api/v1/chat/conversations')->json('data'))->keyBy('id');

        $this->assertTrue($rows[$group->id]['canLeave']);
        $this->assertTrue($rows[$group->id]['canDelete']);

        // So the screen never offers a control the server would refuse.
        $this->assertFalse($rows[$direct->id]['canLeave']);
        $this->assertFalse($rows[$direct->id]['canDelete']);
    }

    public function test_somebody_outside_the_room_cannot_touch_it(): void
    {
        $room = $this->room();

        $stranger = User::create([
            'name' => 'Nobody', 'email' => 'nobody@example.com', 'password' => bcrypt('x'),
        ]);

        Sanctum::actingAs($stranger);

        $this->postJson("/api/v1/chat/conversations/{$room->id}/archive")->assertNotFound();
        $this->deleteJson("/api/v1/chat/conversations/{$room->id}")->assertNotFound();
    }
}
