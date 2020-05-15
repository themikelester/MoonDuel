Change Log
==========

##### TODO
* Pivot around whichever foot is grounded, or lerp between them if in the air
* Improve stopping from running. Maybe a small skid?
* Skidding 180 when about facing along the vertical axis
* Trickle ICE for WebUDP connections. Waiting for all candidates to complete makes connecting take forever.
* Use EXT_disjoint_timer_query for GPU profiling
* Swords get thrown when two attacks collide
* Hit-stop when attacks land
* Pause and Step in the debug menu pause server time as well. (Useful for animation debugging)
  * Render time should then be scrubbable for all saved frames
  * Separate steps for render (configurable dt) and sim 
* Start in offline mode. Don't wait for connection before becoming playable. This may mean implementing prediction.
* Fix save state for faster iteration time. Entities (including camera) should be placed back in their same states.

### 2020-05-15
##### Morning
Yesterday I didn't work much, but I did fix the DebugMenu settings not persisting between reloads. This was a bug introduced when I switched from main.ts to the client.ts/server.ts architecture. Since the SaveState system was dealing with JSON and wasn't typed, TS didn't catch it. I also fixed a bug which was causing the sword to render as black. The material uniform buffer was never calling `write()`.

Now that sword swinging is networked, I'd like to focus on collision/hit detection until the end of next week. This entails bounding volumes for the sword and avatar (likely a bunch of capsules), collision tests, a system for performing the hit tests (probably each avatar checks for hits with its own weapon), a hit event (a reliable net message), more state for the avatar, and reaction logic when the avatar gets hit. For now I may just knock them down, we can handle death and respawning later.  

### 2020-05-13
##### Morning
Today I'm going to implement an attacking animation, and network it. I'll need key/mouse mappings for horizontal and vertical attack (probably just do horizontal today, vertical if I have time). I'm thinking Q and E, left and right mouse, second touch horizontal and vertical swipes (for keyboard/mouse/mobile respectively). Avatar state will also need new fields for attack start time and type. When the server receives a user command with one of the attack actions active, it updates the avatar's object in the World by setting the attack time and type. When the client receives the new snapshot, AvatarAnimation will play and mix the animation with walking/running based on the start time. AvatarController will need to change to handle the attacking state. Max speed would slow down significantly.

#### Evening 
I did it all. The most interesting new thing was that I added a bit of a "blend tree" / "state machine + transition" concept to AvatarRender. When the AvatarState is attacking (it has a non-zero attack type), the animation will blend between the attack and movement animations based on how the time into the attack. Essentially there are two states, locomotion (which already has an internal blend tree) and attack, and there is a transition between them. While transitioning their weights are blended from 0 to 1. I implemented and networked both horizontal and vertical attacks. I ran around a bit with Adam and we swung the swords at each other.

I think now is a good time to do some cleanup of known bugs and improve iteration time. I spent a lot of time trying to fix the random WebRTC connection failures. I thought I had it a few times (offers and answers now contain all candidates, don't use any STUN or TURN servers in development mode), but it still happens. I finally broke down and posted a StackOverflow question about it: https://stackoverflow.com/questions/61770504/seemingly-random-webrtc-ice-connection-failure-when-connecting-to-same-machine.

### 2020-05-12
##### Morning
I went back and reviewed some of the QuakeWorld netcode. In addition to the player data which is serialized and transmitted, they also store a list of entities. The entity struct is shared by every non-character entity, and is basically just indexes for mesh, skin, texture, etc. The characters have one entity as well, stored at the start of the "entity dictionary", but these are transmitted separately. Each frame the entities that a) have a model and b) are visible to the client's entity are sent to that client. If the client knew about the entity previously, a delta is sent. This feels very simple. I can store all game objects in the entity list (which would currently only be a camera and weapon, characters are separate). Since the camera does not have a model it would not be replicated over the net, but it could be serialized locally for hotloading. 

#### Evening 
That went well actually. I added a World class on the server which manages a list of game objects. AvatarState is a game object, and so is the basic state of a weapon (currenyl its parent avatar index and an object id). Snapshot now contains the other objects in addition to avatar state. The game object for weapons is replicated across server and client. The client as a new Weapon system for rendering the objects from the snapshot. It pre-allocates all the necessary resources, and then at render time it matches them to an object based on its id. End result for today is that now all Avatars have swords equipped (attached to their hand), which are also destroyed when the avatars are destroyed. 

It's still very messy. Tomorrow I'll need to simplify the Snapshot and game object systems. Right now the serialization code is all over the place. I think the snapshot concept should go away, or at least not be exposed outside of NetModule/NetClient. The snapshot is a compressed version of the canonical World. The server creates a Snapshot from its World, and sends it to each client (they may be different, because of delta compression). The client receives the Snapshot and decompresses it into a WorldFrame. WorldFrames are buffered so that they may be interpolated. Each display tick, the client interpolates to compute a WorldFrame, and renders it. In order to do so some systems will need to keep extra state in addition to what is stored in the WorldFrame. These extra properties can be linked to their world objects by the object id. 

### 2020-05-11
##### Morning
I'm giving myself until the end of this week to have a sword implemented and have the avatar swinging it in reaction to an attack input from the user. I did a lot of research into Entity Component Systems over the weekend, mainly studying the architecture that Overwatch used (https://youtu.be/W3aieHjyNvw). I was having trouble fitting weapons and attacks in the current architecture, so I've started a branch where I'm trying to implement ECS. If I can get it working and have the attack finished by the end of the week, I'll keep it.

#### Evening 
I was able to get the Avatar skeleton and models loading and rendering in the new ECS system. It feels very sloppy and I definitely haven't fully grokked the patterns that I should be using. Tomorrow I'll work on getting the animations working (via some kind of animation component).

#### Later that evening
After sitting on it for a while, I think I'm going to abandon ECS, at least for now. I am just too unfamiliar with it to make the kind of progress I need to feel productive and stay motivated. It may be useful for replicating objects via netcode in the future. Tomorrow I'll try implementing weapons using the traditional system based approach. The weapon is an object which has a model and a transform, the transform gets parented to the hand joint on equip. Now that I'm writing it, that sounds an awful lot like ECS. Separating transform out of the Model is definitely a good idea. Perhaps I'll try it again with more relaxed restrictions. Previously I was trying to mimic Overwatch, which strives for "pure" systems with no state. Without that, I almost have ECS already. The client/server would just keep an entities array, the existing systems stay, and I add new components one by one. The first two components would be model and transform. The weapon system would create an entity to represent the weapon, and set the transform's parent to the correct avatar joint (which is not a component). That would be a pretty minimal change from what is in master. Systems are allowed to have state, they just share a common method interface. 

### 2020-05-08
##### Morning
Today I'm going to start working on implementing attacks and weapons. I might do a bit of exploring around a scripting/entity system. The naive way to approach this would just be to implement attacking animations in the Avatar subsystem and see where that leads, which may not be a bad idea. I should go hunt down a simple sword model to use as a placeholder first. 

### 2020-05-07
##### Morning
Now that it's been a month on networking, I'm going to push forward in other areas. I'm going to spend cleaning up iOS and Safari support, and then move on to weapons and an attack system. iOS doesn't seem to be able to load anything at all, so I'll debug that first. 

##### Next Morning
It turned out that iOS Safari was broken because the avatar vertex shader was using too many uniforms. Surprisingly, while most devices support at least 512 (and my laptop supports 1024), the iPhone 6 only supports 128 vec4 uniforms. Since we were using up to 44 mat4's to represent the bones, the glsl shader compile was failing on 128-limit devices. I now store the bones in a texture (each row is 4 RGBA F32s representing each of the 4 columns of the matrix), which is sampled in the vertex shader to construct each joint matrix. The texture size is currently 4xBoneCount. This could be reduced by storing the matrices as row major and only having it be 3 texels wide, or by using keeping column-major and using RGB format. But both of those would require swizzling the data each frame before upload, which probably isn't worth it since CPU is such a hot commodity. 

### 2020-05-05
##### Morning
I'm going to give myself two more days on networking, and then move on to weapons/attacks. I found a great youtube series yesterday that analyzes netcode of popular games (https://www.youtube.com/playlist?list=PLfOoCUS0PSkXVGjhB63KMDTOT5sJ0vWy8), and learned a ton by looking at the net graphs of other games. I'm going to try to implement some of the things that I saw:
- RTT and Ping. Compute ping (just network travel time) by subtracting the time that the server held onto the packet from RTT
- Better server time computation by using ping and not RTT. 
- Ping variability. Standard deviation?
- Text info for RTT, Ping, Interpolation delay, Loss % in/out, Packets per second in/out
- Warning Icons for packet loss and missing frames (last msg from server older than interpolation delay)

##### Evening
I knocked out most of the above, except for warning icons. Server clock sync is now rock solid. It's within 0.05 to 1.3ms difference for all network conditions. The issue was that we were using the server frame to compute the server time at which we received the packet, but that can be off by as much as 15.99ms, since fixed frames are "produced" by the server time and therefore always behind. Now we encode the current server time in the frame and use the new accurate ping measurement to get the one way trip time. 

I spent a few hours making the new NetStats panel. It shows average min and max of the stats listed above. 

### 2020-05-04
##### Morning
I spent a few hours over the weekend finishing all the todo's from Friday (except for the NetClient timeout). I also fixed up the client's server time estimation. There was a bug where it would only be computed from the first ack, instead of the fastest. Now it is properly adjusting. 

Today I'm going to try to get renderTime and clientTime adjustments in. The issue this is trying to solve is that when ping changes, or even just settles after the initial flurry of messages, clock times need to adjust to the new rtt. If clientTime is too close to serverTime, user commands won't reach the server before their frame is processed. Likewise, if renderTime is too close to serverTime, snapshots will be late and we'll be forced to extrapolate. So we need to adjust these times. But snapping them directly would cause world objects to snap (Your avatar if moving clientTime, and everything else when changing renderTime). Instead, to speed up clientTime, I'll compute a 16ms fixed frame every 15ms. So the client will start sending frames to the server faster than the server is expecting them. Once clientTime reaches targetClientTime, it returns to the standard tick rate. The same goes for renderTime, except we'll want to modify renderDt each frame. 

This idea is based on the Overwatch netcode (https://youtu.be/W3aieHjyNvw?t=1530). See my previous plan [here](#4-30Morning)

Even with this smooth acceleration to the target time, the effect is still jarring. We want to avoid making clock adjustments too frequently. If we're too close to server time and missing frames, increase the delta immediately. But if we're trying to reduce the delta (ping or packet loss has improved), wait a specific amount of time T. If we toggle from "good" to "bad" quickly, double the time T before we return to "good". For every 10 seconds we're in good mode, halve the time T. This is a basic congestion avoidance algorithm, but is applicable anywhere that you want to reduce thrashing between modes. Glen Fiedler describes it at the bottom of this article: https://gafferongames.com/post/reliability_ordering_and_congestion_avoidance_over_udp/. 

We'll also need to limit how far ahead and behind the clocks can get. If the ping goes astronomical (say greater than 250ms) and stays there, we're going to drop the client anyway. But if it's just a short period of bad behavior, we don't want to the clocks super far away and then have to bring them back in again. I'd say limiting the server-to-client/render time difference to 250ms (which is what you'd get with about 500ms ping) makes sense. 

##### Evening
Okay I implemented pretty much everything I mentioned above, but with different algorithms. First off, Clock manages both renderDelay and clientDelay, which are the offsets from the cannonical serverTime. Each tick, if renderTime does not equal `targetRenderTime = serverTime - renderDelay`, the renderDt is modified by up to 5% in order to approach the target time. Same for clientTime. So now when we determine a new target time, the real time will smoothly approach it by speeding up or slowing down time (time warping). 

It's NetModule's job to determine when to make those adjustments. For client time, I landed on a system that is constantly adjusting the delay to try to keep 1.5 (averaged) client frames buffered on the server. Each server frame now contains the "frame difference" between client and server, which is the `lastClientFrameReceived - lastClientFrameNeeded`. If the server is starved for client frames, this will be negative. Each time we receive a server frame, if the average of this frameDiff differs from the target of 1.5, the delay will move 1% towards the delay that would yield the target frameDiff. Since modifing the clientTime won't produce a measurable effect on frameDiff until we hear back from the server RTT ms later, we need to adjust slowly so that we don't overshoot. 1% seems to perform well. Note that this is basically double smoothed, as the Clock still smoothly adjusts clientTime to the new delay.

RenderDelay is more complicated. While clientTime is only used to decide if we need to simulate more fixed frames, renderTime is used to sample and render the world state. So performing a time warp on renderTime will visibly speed up or slow down game objects. We want to do as little warping as possible. The algorithm I ended up with goes something like this:
- If a server frame every arrives so late that we needed to extrapolate (3 frames late if the target frameDiff is 3), adjust renderTime immediately so that it would have arrived on time. Since frames arriving out of order are ignored, a late frame means that it didn't just get stuck some where, but that the transit time from the server has increased. This is the main case that I'm trying to cover with renderTime adjustment. E.g. you're on mobile and you connect to a slower tower.
- Every x seconds (currently 10), check to see if the average frameDiff is significantly different from the target. If it is, adjust the delay so that the average would arrive on time. 

I think both of these work quite well. I tested them by varying the packet loss and delay with my network shape script, and watching how fast it reacts to reductions in quality (fast) and improvements (slow). Overall I'm happy with it.

### 2020-05-01
##### Morning
Today I'm going to spend (hopefully just a few minutes) fixing up NetGraph, then work on client side prediction. By the end of the day I'd like to have prediction working with instant reconciliation (in the case of a mispredict, we just immediately snap to the server's position, instead of interpolating). 

##### Morning
After doing a quick trans-sydney playtest with Adam (40ms ping, great quality), I've decided that it'd probably be better to fix up all the server connectivity issues first. The number one problem is the zombie server sitting in a room after it has disconnected. If you reload the page, you'll connect to the old server's id even though it isn't listening, and the game is bust. I could fix this with host migration, though that might be tough. 

I think first I need reliable messages. That will allow for the possibility of host migration, as well as simple messages like connected and disconnected. It would also be good to notify the server when a client goes into the background. It would be great to detect if the server backgrounded and just pause the whole game. Eventually this would be fixed by playing audio through the client so that chrome continues to tick the server even while backgrounded. 

A bug that appeared during the Adam playtest: he first connected with his phone (through clicking the link in the discord app), then closed the app (swiped up in the app switcher), yet that client maintained a WebRTC connection for about 5 minutes. The server thought it was alive the whole time and continuously sent packets to it, receiving none in return. This means we'll need a NetChannel/WebUdpSocket timeout that is capable of closing the connection. 5 seconds sounds good to me.

So, for today I'd like to get: 
- Reliable messages in the NetChannel layer
- Fix "zombie server" bug. 
    - Set up a handler to disconnect from the room when the host tab closes (already doing this for the WebRTC code)
    - Either join a random room each time, or start working on host migration
- Send a reliable message when the tab is backgrounded 
- Server stops sending data to backgrounded clients, and doesn't complain about missing inputs
- Server's WebUDP should never error when a client leaves. It should check for channel.closing and channel.closed before send
- NetClient disconnects after not receiving a message for some timeout, lets start with 5 seconds

##### Evening
It took me a while, and three attempts, but I'm finally happy with the reliability layer. At first I tried implementing it at the NetChannel layer, but then I saw this from one of the Quake 3 Arena devs (http://fabiensanglard.net/quake3/The%20Quake3%20Networking%20Mode.html):
> The final iteration (Quake3), which was the first time he really felt he "got it right" (whereas Carmack always felt a little uneasy with previous implementations' fragility), used a radically different approach.  With Quake3 he dropped the notion of a reliable packet altogether, replacing the previous network packet structure with a single packet type -- the client's necessary game state.

> All reliable data that another node needs is sent repeatedly until the sender receives an update for most-recent-ack (indicating that the packet has been received). For example, if a player sends a chat message (reliable) with update 6, he will continually send that chat message on subsequent state updates until he receives notification from the server that it has received an update >= 6.  Brute force, but it works.

So that's what I did, at the NetClient level. When a Client update goes out, if there is a reliable message buffered, it gets sent too. If an ack come in that's greater than the frame we first sent out the reliable message, it's ack'd and removed from the buffer. Only ended up being about two dozen lines of code. Reliable messages! But I didn't have time for anything else, so all of the TODOs above are still valid.

### 2020-04-30
##### <a name="4-30Morning"></a>Morning
Today I'm studying the NetGraphs and trying to improve the perceived performance of the netcode. I think this will mean supporting renderTime and clientTime contraction and dilation. I.e. the client misses a few frames from the server, or its ping changes, so it dilates time to increase the time difference between renderTime and serverTime. When conditions improve it can contract time to speed things up and return to the optimal time difference. The same goes for client time if the server says that an input arrived late (as detailed in https://youtu.be/W3aieHjyNvw?t=1530).

I think a good metric for success would be making it playable at 5% packet loss with 200ms ping (using the NetworkShaper.sh script). As of now, using both packet loss and delay in the shaper causes ping to skyrocket to around 1.5 seconds. I have no idea why this is happening, but it may be due to congestion (either real or artically induced by the shaper, not sure). So I may need to optimize packet size today.

##### Next Morning
Yesterday I added serialization functions (writeInt, writeByte, etc.) to NetPacket, and used these to implement proper serialization for UserCommand and Snapshot. The in/out bandwidth is now about 10/125 kbps, down from 200/325 kbps. The network shaping issues mentioned above don't seem to be a factor any longer. This must have been due to bandwidth limitations. I also improved NetGraph so that the serverTime/clientTime/renderTime are constant and the frames scroll by. This is going to make it easier to visualize when clientTime/renderTime are dilated/contracted. There are still some bugs that I need to fix up this morning, like re-drawing ping and resetting the state of frames that are no longer visible.

### 2020-04-29
##### Evening
Just worked for a few hours late in the day. Improved clock synchronization using a technique that I haven't seen anywhere. When the Client gets an ack, if it is the fastest round-trip-time so far we recompute server time as 'frame + rtt * 0.5'. This is making the assumption that the smaller the RTT, the less chance for non one-way transmission time to have crept in. E.g. assuming the packets take the same route and have essentially the same one-way time due to the network, you'd get an optimal RTT if the client's packet arrives on the server jussst before the server processes a tick and sends a client reply. In which case that packet would contain an RTT that is almost exactly twice the network one-way time with very little overhead. That is the case that this algorithm tries to detect.

I also added a bunch of new stat computation to NetChannel, which should be useful in the coming days. We keep an 8 second buffer (for 60hz messages) and compute all packets in a sliding window based on that history. So ping is computed as the average RTT of all packets received in the last 8 seconds. I also compute packet loss, and in/out bandwidth in similar fashion. 

Found a few new good resources to read up on. The TRIBES networking model, which I've seen referenced in a few places: https://www.gamedevs.org/uploads/tribes-networking-model.pdf. And the slides from the Bungie Halo: Reach networking talk: http://downloads.bungie.net/presentations/David_Aldridge_Programming_Gameplay_Networking_Halo_final_pub_without_video.pptx

### 2020-04-28
##### Morning
Today I'm going to work on improving the user command -> server pipeline. I spent the morning reading https://leanpub.com/development-and-deployment-of-multiplayer-online-games-vol1, which didn't contain as much useful information as I was hoping. But I did rediscover https://developer.valvesoftware.com/wiki/Latency_Compensating_Methods_in_Client/Server_In-game_Protocol_Design_and_Optimization, which showed me that Source does not include timestamps/tickstamps on their user command packets sent from client to server. The server just processes them as soon as it can. This approach seems easier, but it makes less sense and seems less desirable to me than the Overwatch approach (where the server expects input for each tick, and uses most recent only if it is late or missing). So today I'll implement command duplication, which means sending all non-acknowledged commands in each packet. Afterwards I may start on time dilation/contraction, which would be necessary for the Overwatch approach. 

Time manipulation would also allow me to implement something that I want to do for this game, which is hit stun. That's the effect where time appears to pause for a quick moment when you land a hit on an enemy. The render time would pause while the simulation time continues normally, then we would render sim frames faster than usual so that render time can catch back up to its normal time (interpolation delay ms behind the sim time). 

##### Evening
I ended up having to spend most of the day fixing bugs and misunderstandings before I could finally spend the last hour actually implementing packet loss protection for client->server user command frames. 

First off I updated the Clock concepts so that the time between renderTime and serverTime (renderDelay) was configurable, as was the time between clientTime and serverTime (clientDelay/clientAhead). This was necessary because we're timestamping the UserCommand packets, so the client must simulate ahead of the server. I.e. the client simulates/predicts frame 44, and sends the command for that frame. The server receives it on frame 42, and then processes it on frame 44. The clientAhead time must be such that the UserCommand has time to arrive on the server and be buffered for enough time so that any dropped packets have time to be replaced by a subsequent one before they're needed. Now that clientAhead is configurable, it's easier/possible to test that replacement mechanism.

Next I updated the NetGraph (pictured in yesterdays update) so that the Client and Server graphs display the same absolute time. Previously they were both aligned so that their version of server time was centered. Since the clocks are not perfectly syncronized (in fact they're often very desync'd), this meant that it was useless to compare the two. E.g. client commands were appearing to arrive on the server before the current client time. Now the server graph centers on the client's version of server time. It also renders the true server time as a bar, so that I can visualize the descrepancy. I really need to implement a better clock sync, this is going to bite me soon since so much depends on it. Perhaps a good task for tomorrow.

There seems to be some kind of bug with the network shaper I'm using on OSX. When the packet loss and delay are set to non-close-to-zero values, the one-way delay from client to server increases drastically (E.g. 3.5 seconds). The other direction from client to server is not affected. It feels like the dropped and/or delayed packets are being queued which fills up and starts to starve itself out. I'm really not sure what's going on. I sunk a few hours investigating this, and then dropped it because 2% and 20ms of delay seems to work reasonably well. But it definitely seems like it should be able to handle 10% drop 200ms delay no problem. An issue for another day.

I then realized that NetClient had no way to know when its high level payloads were being acknowledged. It needs this information to determine which UserCommands to send in addition to the current command. NetChannel knows when its packets are ack'd, but that operates on sequence number and NetClient wants to know when specific frame messages are ack'd. I decided against trying to use the frame number as the sequence number, because sequence numbers want to stay small and wrap (currently 16 bits wrapping at 65536) while frames definitely don't want to wrap. I found a very tidy solution. NetChannel.send() now accepts a numeric "tag" in addition to the payload. When NetChannel receives a new message and fires the RECEIVE event, it also includes the tag of the latest packet that was acknowledged. NetClient uses frame as the tag, so in its onReceive handler it can update the lastest frame that has been acknowledged. Neat. I've also realized that NetChannel doesn't need to and shouldn't be doing any buffering of the packet data. It only needs the packet meta-data. It SHOULD buffer data for reliable messages though, as the content of the payload doesn't need to be known when it is re-transmitted. NetClient can do (and already does) the buffering at a higher level. I'll knock that out tomorrow.

And then finally at the very end of the day, in about half an hour, I updated NetClient to send all unack'd user commands, and then fill in the gaps for any dropped packets on the server side. I tested this with some network shaping (2% drop) and it works nicely. The NetGraph draws "filled" packets as yellow. Phew.

### 2020-04-27
##### Morning
Excited to work on some networking debugging features today. I'm going to render out a timeline graph for the server and each client that has the missing/received state for each packet. That should illustrate when the server is missing input packets and when the clients are missing state. Then I can start doing some network shaping (e.g. 5% packet loss, higher ping) to see what needs work. The client will definitely need the ability to contract time so that it can get farther ahead of the server to avoid dropping input. I'll work on that if everything else goes well.

##### Evening
![Daily Screenshot](/screenshots//2020-04-27.png?raw=true)

Good day. Got a very solid feeling net debug graph implemented. Fixed a bad bug in NetClient that was causing old UserCommands to be read. I think this was what was causing the "no input for several seconds after connecting" bug. Also added a shell script for OSX to do some network shaping. Currently sets packet loss to 2% and adds 100ms of RTT. This exposes a huge batch of issues when we drop frames, and that's the work for tomorrow.

### 2020-04-25
##### Morning
When a client joins, the server needs to to include the current time/frame so that the clocks can synchronize. From the client's perspective, the current server time is time that it received in the message, plus half round-trip-time. Then the client can render X ms behind the server state (interpolation time) and stay X ms ahead of the server so that it doesn't starve for input. 

Current overview:
Each snapshot that comes down is tagged with the server frame. The client wants to be rendering the interpolation between the latest two frames received from the server. The latest frame is going to arrive about half-rtt behind the current server time. So the maximum target render time should be about server time - (half-RTT + half-frame).

The logic above determines the state that the client renders EXCEPT for the local avatar, which will be a few frames ahead because of prediction. The client wants to stay X ms ahead of the server so that the server never misses the clients input for a given frame. This time is at least half-RTT, plus some buffer. So if the server time is frame 40, and the render time is frame 38.5 (16ms frames, 30ms ping), then the client time should be about frame 42. It takes 15ms for the input for frame 42 to reach the server, and the server won't process frame 42 for another 32ms. Even if the packet is dropped, the next packet for frame 41 may reach the server, and it also contains all recent unacknowledged input commands. 

As for rendering, in the scenario above, the client would render the state of the world (all the other avatars) as they were at their canonical positions as of frame 38.5 (the current render time). It renders its own local avatar as of frame 42 (the current client time). In the case of an attack on this frame, the client sends its attack command and its current render time (38.5, but this doesn't actually need to be transmitted, the server can compute it) as of frame 42. When the server processes frame 42 (assuming it didn't miss your input), it knows where you and everyone else are as of frame 42. It rewinds everyone else (not you!) to the render time of your client, 38.5. Now the server's state has your position as of frame 42, and everyone else's as 38.5, which is exactly what you saw on your client when you attacked. It evaluates the hit and responds to your client. You receive the response two frames later on frame 44. 

##### Afternoon
Woohoo! Got the clients syncing to server time. And AvatarSystem is detecting the client's avatar (so the camera follows correctly). There are still bugs/unimplemented features related to client time vs server time (some inputs seem to be getting lost), but those seem very understandable. Basic "multiplayer"! Now I'm going to try to deploy the signalling server somewhere public so I can test this across networks.

### 2020-04-24
##### Morning
Avatar day. When the server detects that a new client has joined, it needs to activate a new Avatar and assign it a clientID that matches the new client. The client probably needs to send some kind of initial state so that we don't have to pop the avatar, but maybe this is not necessary if we also change maps. I'm having a hard time planning out how adding a new Avatar will work, so I'm just going to get in there and see what happens.

Now that NetClient is stable I'd also like to redo the ping computation. 

##### Next Morning
It wasn't avatar day. I was having trouble focusing. I ended up doing more cleaning of the netcode, and re-implementing ping detection at the NetChannel level.

### 2020-04-23
##### Morning
I really need to do some cleaning up. I often have to restart a few times before a client->server connection can even be established. I think zombie instances are hanging around and staying connected to the signalling server.

##### Evening
Spent the whole day cleaning up. Most of the changes were to the way that WebUdpSocket wraps the WebRTC connection. Now it opens it's own socketio socket to the signalling server, instead of being handed one that is already connected. All it needs is the serverId, just like a UDP socket would need the server address. This means that the game is still ignorant of the concept of rooms, it just attempts to connect to server. The game is back to the state it was in last night, where there is a terribly ugly form of "multiplayer" happening, except now NetClient, NetChannel, and WebUdpSocket are pretty clean, and multiple clients can connect to the same server. 

I still haven't submitted the changes to make the "multiplayer" work (client sends updates, server sends snapshots) because it's super dirty. Tomorrow I'd like to clean that up and get it submitted, figure out how to broadcast to everyone that a new client has joined / create its avatar, and start sending simulation frame numbers with these packets (right now it's just "lets grab the latest data available and use that"). 

### 2020-04-22
##### Morning
Today is the day I'm going to try to actually implement "multiplayer". I'll have the client send UserCommand messages to the server, and the server will send everyone Snapshots. The client won't bother doing any prediction, it will just dumbly render the latest server state. That should allow me to play a reasonable quality multiplayer "match" locally, since the latency is basically nil. After that, I'll need to implement prediction, delta encoding, and UserCommand buffering.

##### Evening
I was able to hack together the client sending input, server accepting input and running simulation, server sending state back, and client rendering state. But it is super dirty, and not even committed. There seem to be WebRTC troubles when I attempted to get a second client to connect, and all sorts of other problems like the server having its own avatar because it has a ClientID. Lots of stuff to clean up for tomorrow.

### 2020-04-21
##### Morning
Today I'm going to work on cleaning up the netcode, and separating server logic from client logic. Mainly the issue detailed below, where the server loop needs to run on a setInterval not requestAnimationFrame. The "host" (a client which also acts as the server in a p2p environment) should run both of these loops. I'd also like to get a pure server (where the client logic doesn't run, i.e. a headless host) implemented so I can leave it running in a background tab and have clients connect to it. That would make it much easier to test and improve the "client disconnected" logic. Right now I think it takes way to long to detect a disconnect. 

I'm also a bit worried about maintaining a websocket connection to the signalling server during gameplay. When disconnected it looks like the sockets are polling, and I wouldn't want any TCP traffic going out during the game that could disrupt UDP packets. If I can ensure that there is absolutely no traffic on the signalling socket that we could try to maintain a connection, otherwise I think we should tear it down after the WebRTC pipe is set up. But that's likely a problem for another day. 

##### Afternoon
Well I set up a separate server bundle (basically main.ts with all non-essential modules removed) which webpack builds into a separate server.html. When running this tab, everything works great, clients can connect and talk fine. But if the server/host tab is in the background, chrome throttles it to 1 tick per second. I learned that web workers are not subject to this. "This is perfect. I'll run the server code on a background thread and the client code on the main thread. The server code can send out WebRTC data channel packets just like normal, and the code can remain completely separete". Turns out, WebRTC is not yet supported on workers. There is a lot of discussion and positive interest in this on the forums, so I wouldn't be surprised if this is added in a future RTC version. So WebRTC stuff must run on the main thread. There is another exemption to the 1hz rule: If the tab is playing audio, it is considered foreground and is exempt. This could definitely work, as the main case I'm trying to prevent is the host switching tabs for a few seconds to look at something and sending everyone's ping to 1000+ms. So I think I'll continue pursuing the architecture where the "host" is just running server and client code together on the main thread.

##### Next Morning
I was able to get a pretty nice client/server side-by-side architecture going. Each "instance" starts executing the client code immediately, which means you get to see your avatar and move him around ASAP. A SignalSocket establishes a connection to the signal server and attempts to join a room. If it succeeds, and the signal socket is chosen as the server, the instance starts executing the server code and assigns the signal socket to it. A new signal socket connection is started, and once connected, this is assigned to the client. If the first socket joins the room and there is already a server, it gets assigned to the client immediately. I think this will work well as a p2p architecture, at least in the near term. Since both the server and client code are running in the same JS context, they share globals. The only trouble this caused was with the DebugMenu, which is no longer a global but a toplevel member of both Client and Server.

### 2020-04-20
##### Morning
Oops, forgot to write the closing changelog last time. I didn't quiiite get two peers connecting via WebRTC, so I'm going to continue to persue that. After mulling it over on the weekend, I think I've come up with a solid connection protocol. The game starts and establishes a connection to the signalling server (I could just place a few of these around the world). The signalling server determines which room you will be in (either because you chose one via URL, or randomly). It replies to the client with the room description, which contains the ID of the server as well as all other clients in the room. The server can be a dedicated server for public/random rooms, or another peer for custom rooms (so that if you live in whoop whoop, you can still play with your friends with low ping). The client then starts attempting to establish a WebRTC connection to the server (or does nothing if it is the server). If another client joins, it attempts to connect to the server. Once a WebRTC connection is established, we do everything as normal. 

##### Evening
Woo! I was able to do pretty much what is laid out above. It took a while for me to figure out that establish the WebRTC connection between peers is not symmetric. One is the "local" and one is the "remote". Only the local creates a datachannel and sends an offer. The remote listens for the offer and sends an answer, and initializes its datachannel based on the results of the RTCPeerConnection.ondatachannel callback. The state of the netcode is now extremely sloppy. NetModule establishes a connection to the signalling server, which tells us what room we're in and the state of the room. WebUdpSocket and NetClient are pretty hacked up, as NetModule creates WebUdpSockets directly and passes them to NetClient. Tomorrow I'll clean all this up and send some useful messages back and forth. 

There's also a big problem with p2p architecture at the moment. The "server" code needs to execute even when the tab is in the background, which means we can't use the standard requestAnimationFrame update loop. We'll need to use setInterval. 

### 2020-04-17
##### Morning
Late start. Spent the morning reading a few more articles, the most useful was https://developer.valvesoftware.com/wiki/Latency_Compensating_Methods_in_Client/Server_In-game_Protocol_Design_and_Optimization which talks a bit more in depth about the state of other players while the client is predicting inputs. I've been struggling to understand how that works. 

Now that the client can mostly/kind-of interpolate and render based on a buffer of simulation states, the next step is to share simulation states across the network. For the client-server architecture, this means implementing a node<->C++ communication layer so that the WebUDP C++ library can handle the networking, pass the packets off to a node accessible buffer, and node can run the same prediction code that the client is executing. 

Instead of starting work on that, I think I might dig into peer-to-peer options first. This is something that I've had in the back of my mind for a while. We definitely want client-server if you're joining a duel with randoms, e.g. go to moonduel.io just to play a few games, because a cheater would ruin the experience for everyone else in their server/room. But for personal duels / private rooms that are joined via a direct invite, cheating is not really an issue. Having these types of games be p2p has a lot of advantages, the biggest being that you could play with your friends anywhere in the world with low ping (and low server costs!). 

A lot of the logic seems to be shareable between a p2p and client-server architecture. The ideas of simulation interpolation, and lag compensation / favor-the-shooter could be the same. Each client renders themselves at the current time T, and everyone else at time T - D, where D is the interpolation delay, say 100ms. If we go to interpolate the simulation state for time T-D and we don't have state for one of the players, we extrapolate their position (up to a limit, say another 100ms). When we attack, we're attacking against the state of the world which is D seconds old. We broadcast that we've attacked at time T-D (the simulation time that we were rendering) from our current position (which is really at time T, but that doesn't matter). The attackee receives the message some time later, and rewinds their state to time T-D and evaluates the hit. This is based on everyone's clocks being synchronized, which is achieved by the round-trip-time measurement system that I already have in place (time sent vs time acknowledged). 

I'm going to spend some time investigating how hard it would be to get a WebRTC peer to peer connection going. Then I think the responsible thing to do would be to develop the systems that both architectures need, such as state reception and transmission, rather than command transmission (which is only needed by the client-server architecture). 

### 2020-04-16
##### Morning
Today is Entity Interpolation day (https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking#Entity_interpolation). Basically now that we have game states in the form of snapshots, we interpolate between the last two based on the leftover fixed frame time so that the simulation results appear smooth. After that I'd like to do a bit of cleanup. 
- Implement reliable messages in NetClient, the quake way (one reliable in flight at a time, almost no extra complexity).
- Remove messageId from the schema as we no longer have to worry about duplicates (since they'll have the same sequence number)
- Calling NetClient::Send should return the sequence number, acks can be checked by accessing the ack buffer with the sequence.
- Replace PacketBuffer with a much more reliable and simple data structure based on % 

##### Evening
I added interpolation, and spent a lot of time thinking about and fixing up the Clock system. I've settled on what I think is a pretty good architecture. Clock maintains three sets of times: 
 - realTime/realDt, the CPU-based time at which this display frame started executing
 - simTime/simDt, the time at which the current simulation time is executing (always behind real time) 
 - renderTime/renderDt, the time at which the simulation will be sampled and rendered during this display frame

At the beginning of each display frame (when the requestAnimationFrame callback fires), real time gets incremented by the real CPU dt. If the simulation time is behind the real time by more than the fixed simDt, UpdateFixed() is executed and simTime is increased by simDt. UpdateFixed() can be called multiple times in a single display frame, or not at all. The display frame "produces" time and the simulation consumes it. After UpdateFixed() has had its chance(s) to produce more simulation results, renderTime is used to interpolate (or extrapolate) the current simulation state for this display frame. Update() and Render() then consume this state and display it.

Render time can be dilated and contracted. E.g. to implement a "hit stop" effect, we can slow down render time when striking an enemy, then increase it to catch back up with the most current sim time. This doesn't effect the simulation, and if it is quick enough, the user won't notice the lack of input response. 

Sim time can also be manipulated, e.g. to send more user inputs to the server if we're experiencing packet loss. This increases the client's time compared to the server's, and thus gives the server more of a chance to get our input for a given simulation frame. Overwatch uses this technique and it's described in https://youtu.be/W3aieHjyNvw?t=1530.

I also did a bit of NetClient cleanup and simplified PacketBuffer. We don't need a complicated ring buffer structure, we can just use the sequence modulo the buffer size. This was done in Quake World and seems very clean. 

Finally I did a bit of work in the Avatar system so that it can handle multiple Avatar states. It's ready to consume AvatarState objects from the server!

### 2020-04-15
##### Morning
I realized that there is a large storm cloud ahead. The server is currently written in C++, but it needs to simulate most everything, and in the same way as AvatarController.ts so that the client prediction is accurate. This would be much easier if they used the same language and could share the implementation. This may mean I need to look into running node on the server. I could have C++ handle the networking, running one thread per client, and copy messages in to JS-accessible buffers which it reads each tick. I still need to do more research.

I think today I'll continue to do some more reading about netcode architecture. I'll also implement RTT measurement on the server and client by measuring the time between packet sent and packet ack.

After watching https://www.youtube.com/watch?v=W3aieHjyNvw&list=PLSWK4JALZGZNVcTcoXcTjWn8DrUP7TOeR&index=2 (great talk about Overwatch architecture and netcode), and reading https://gafferongames.com/post/fix_your_timestep/, I decided to start working on an updateFixed() based architecture for deterministic simulation on the client.

##### Evening
Big day. I struggled for a while which what to work on. After studying the links listed above, I implemented a fixed timestep updateFixed(). Then implemented Input.updateFixed(), which generates a UserCommand that can be sent over the wire. After that I worked for several solid hours modifying the Avatar system to work with updateFixed(). AvatarController now takes an AvatarState, UserCommand, and dt (which is fixed) and outputs a new AvatarState. AvatarState is another serializable object that contains everything necessary to position and render the avatar. I.e. if the client has a stream of AvatarStates, it can completely replay everything that Avatar did. The biggest part of this was removing animation updates from AvatarController. It now only updates a few fields like position, velocity, orientation, and some states (walking vs running). 

In order to test that my the new system was actually running completely on the newly generated states, I implemented a Snaphot system. This aggregates all of the states each fixed frame, with the ability to record the snapshots into a buffer, and then play them back. And it works! This is basically how spectating will work. The server will just send the client a stream of Snapshots and the client interpolates and plays them back smoothly. Neat!

### 2020-04-14
##### Morning
I think I'm going to put off implementing reliable messages until I have a basic game message protocol going. I'm going to spend the morning researching flatbuffers and alternatives. If I'm happy with flatbuffers, I'll implement them, but I think they lack bounds checking. 

##### Evening
I spent a few hours digging into Cap'n Proto, SBE, and FlatBuffers. I went with the flat. It's not a perfect fit, it adds some overhead to the message size, but because I'm dealing with C++ and JS rolling my own would be twice the effort. Today I added flatbuffers as a dependency to both the server and client, and wrote a basic schema that they share. They're both sending packet payloads that are flatbuffers, although there's not any meaningful data in there yet. 

Tomorrow I'd like to implement a NetMessage.ts on the client which wraps the flatbuffer data. This is where we'd do validation on each flatbuffer property, detect duplicate messages via messageID, and serialize/compress outgoing messages.

I also need to find a way to share the schemas between the client and server. Currently it's copy/paste.

I finally renamed MoonDuel from gfx-boilerplate. All the DNS routing still seems to work.

### 2020-04-13
##### Morning
Over the weekend I read a lot of Glen Fiedler articles (https://gafferongames.com/post/reliability_ordering_and_congestion_avoidance_over_udp/). I think the first thing I'm going to do is implement a reliability protocol, via ACKs, so that I can send some reliable messages such as client connected, and detect client ping. After that I'll look into different pre-rolled packet schemas so that I can avoid writing a lot of boilerplate serialization/schema code on the server side. I was hoping that flatbuffers would work, but it looks like they don't support min/max values for validation. Hopefully I'll be able to find an open source protocol, otherwise I'll write my own. 

I need to restructure the way that AvatarController and AvatarRender work in order to support multiplayer. There should be an AvatarState array that AvatarRender consumes to pose and render each character. AvatarController, multiplayer packets, and any AI would all be able to modify the AvatarState. If I have time today I'd like to start on that as well. 

##### Evening
It was a productive day, but I underestimated how much work the reliability protocol would be. At 6PM I had it tested (lightly) and working. I basically followed the main idea of the Fiedler article linked above, with 16-bit sequence numbers. Tomorrow I'd like to do some more testing to make sure it's actually working how I think it's working. That probably means adding an API to request a reliable message and then resending it if it fails to be ack'd within the valid time. This requires simulating dropped packets. Can we do this in Chrome? Otherwise I'll have to write some code at the UDP layer to simulate drops.

### 2020-04-10
##### Morning
First off, get the game to send pings to the example EchoServer from https://github.com/seemk/WebUDP, which I currently have running in a Docker instance. Then I'll start a new project to write the game server and start sending custom messages to the clients. Hopefully by the end of the day two clients can be notified of each others existence.

##### Evening
Good day! Got the game talking to the sample server. Set up a new project with a dockerfile that builds the WebUDP project, and links it to a new sample server. https://github.com/themikelester/MoonServer. Had the server relay connect messages to all connected clients, first client->client communication! Next up I'll try to hack in some positional data so that multiple avatars can be seen. 

### 2020-04-09
##### Morning
Same again as yesterday. Time to pound out some libwebrtc builds!

##### Evening
Yes! I spent a few hours and got a bit further trying to build Google's libwebrtc, then got disheartened and went hunting for some other C++ webrtc implementations. Jackpot! Found https://github.com/seemk/WebUDP. Was stuck for a long time trying to get the example running. The server was building and the client was sending at least one TCP message to the server, but it wasn't establishing the rtc connection. Finally figured out that I needed to docker publish not only the :9555 port (which defaults to TCP) but also the :9555/udp port. Apparently the webrtc implementation in JS sends a udp message to the other peer after the SDP is established. Woohoo! 

### 2020-04-08
##### Morning
Same as yesterday. Time to pound out some libwebrtc builds!

##### Evening
Spent a lot of time futzing around with the docker container while trying to get libwebrtc to compile. Had to increase docker's max disk size from 60 to 112 GB. 

Started my own fork of the libwebrtc build tools: https://github.com/themikelester/libwebrtc-build
- Fix for /usr/local/include/webrtc/ not being added to cmake's include dirs: added it via LibWebRTCConfig.cmake
- Fix for abseil headers not being available: https://github.com/mpromonet/webrtc-streamer/issues/126
    - Copy the include files from the src/third-party directory into install dir via CMakeLists.txt

Also started a fork of the client-server demo code that contains fixes for libwebrtc version 72. https://github.com/themikelester/client-server-webrtc-example

It's compiling, but linking is currently failing with some missing libewebrtc symbols. That's a problem for tomorrow.

### 2020-04-07
##### Morning
Oh forgot to mention, I purchased the moonduel.io domain, and hooked it up to the github pages page. Today I plan on getting a Ubuntu docker instance set up, and try to get the client-server WebRTC example from http://blog.brkho.com/2017/03/15/dive-into-client-server-web-games-webrtc/ up and running. Then I'll try to adapt the client code so that I can connect to the server from instances of my client.

##### Evening
MY GOODNESS. Building libwebrtc is quite a chore. I spent the day trying to work through the blog post linked above. Most of that was learning about docker and trying to write a Dockerfile for his project so that I could get it building on Ubuntu. The compile step for libwebrtc takes at least 20 minutes on my machine, and I had to do it three times. I'm currently stuck on getting the project to 'make'. cmake seems to be failing to include the necessary include directories from the LibWebRTC dependency. I'll be looking into that tomorrow.

Of note, I'm not using the install scripts that he linked in the original blog post, but a fork that has been updated to work with the latest libwebrtc "release" which as of now is 72, from early 2019. https://github.com/cloudwebrtc/libwebrtc-build

### 2020-04-06
##### Morning
Implement and solidify touch axes so that I can control the avatar on mobile. Clean up mobile HTML/CSS issues so that there is no scrolling and the app goes fullscreen on touch. Maybe implement some "safe zones" on the sides? I.e. areas where no important objects are so that there's always a place to slap down your pudgy fingers without hiding anything from view. We could just treat the 4:3 center of the screen as the only visible area when computing cameras. Probably a bit early for this. Mobile Day!

If all that gets done it's probably a good idea to write the Mouse input handler, I've been putting that off. That could be used to implement Debug Cam. 

Oh! And I should add access to the debug menu on mobile. Probably touching the top right corner.

##### Evening
I implemented and polished up the Touch axis, so that controls work on mobile, and implemented the mouse input handler. Spent a bit of time futzing around with fullscreen support. Added a web manifest to make this a "progressive web app" :eyeroll:. When it is added to an android home screen, it will launch fullscreen and in landscape, which is nice. Hooked up the '\' key to toggle fullscreen on desktop. Lots of little fixes to touch and mouse handling, lots of stackoverflow reading. Around 3pm I decided that was enough work on the input system, and started thinking/reading about how to implement the backend and middleware. 

I'm pretty firm that I'm going to go for a WebRTC-based client-server (not peer to peer) architecture. There's a really great blog post about an ex-google engineer implementing just such a system as a toy project. I aim to base off of that. http://blog.brkho.com/2017/03/15/dive-into-client-server-web-games-webrtc/. It's fun to day dream about extra features like having peer-to-peer voice chat once the client-server connection is established. I plan to spend at least the next week trying to get his demo running, then adapted to send game messages, then authoring a protocol to send proper game messages, then implementing server logic.

### 2020-04-03
##### Morning
I'd like to get touch controls working so that I can drive the avatar on mobile. This may involve a new input system (could use PlayCanvas'?) or perhaps writing a layer on top of the current one.

##### Evening
I started with PlayCanvas' Keyboard and Touch files, but ended up writing them from scratch. I also re-implemented their Controller class, which seems like a good idea. The caller can register "actions" with keys/buttons, and register "axes" to things like gamepad sticks, or mouse/touch movements. They're version (and Unity's too) of axes don't support touch, but I'm planning on it. It seems like it will map pretty well, but that's a job for tomorrow. I replaced the Noclip version of Input.ts with a small wrapper around Controller. It just sets up a small action mapping and passes through calls to check if an action is active or not. 

Tomorrow I'd like to implement Touch axes so that I can control the avatar on mobile. If that's solid, perhaps also mouse axes to control the camera (or debug camera).

### 2020-04-02
##### Morning
I'd like to get the avatar walking and turning feeling better. No concrete goals, but if I'm a happier with it I'd like to start on getting running working.

##### Evening
Woo! I fixed a big "bug" that was making movement feel very sharp. Velocity direction was changing instantly to inputDir, now it is set to the avatar orientation. This fixes the moonwalking when rotating quickly while standing, and makes the whole thing feel smoother. I added the running animation with a separate set of acceleration and max speed values, and blend between walking and running based on if shift was pressed. Ended up being a good productive day.

### 2020-04-01
##### Morning
After sleeping on it s(and getting a coffee this morning) I think I have a better way to handle camera orientation. I'm going to try to keep the avatar (or target object) within some angular radius of the horizontal center of the screen, and between some min and max distance from the player. First the rotation is evaluated, and the camera is rotated on the Y axis so that the target is within the angular restraint, then the camera moves towards or away from the player to meet the distance restraint. This may be what Wind Waker is doing.

##### Next morning
I wrote the basic camera controller in about 2 hours, and it seems to be working fairly well. It wasn't really a productive day, I probably only got a good 3-4 hours in. With this controller, holding right makes the character turn in an arc relative to the camera distance, because the angular velocity is constant. Wind Waker does this differently. Holding right runs at about 70 degrees, instead of 90. I need to think more about what they're doing.

### 2020-03-31
##### Morning
Did some late night research into Wind Wakers character/camera controller (by running around in circles for an hour).
Today I'd like to have the avatar turning so that he only moves forward, and the camera following this orientation in some fashion.
Hopefully similar to WW's, because I think that scheme works well for laptops that don't have a separate mouse attached.

##### Next morning
Yesterday I was able to get the character changing orientation smoothly, and blending between idle and walk animations. I got stuck on how to handle camera orientation, and didn't make any progress.

### 2020-03-30

##### Morning
Over the weekend I split the avatar system into a root Avatar module which controls the new AvatarController and AvatarRender submodules. AvatarController manages animation and skeleton updates, while Render is in charge of handling GPU data layouts, uniform updates and rendering. GLTF creates Object3D's for nodes so that Avatar doesn't have to worry about that.

Today I'd like to get a basic implementation of AvatarController working so with mouse + wasd input. The avatar's position and orientation should update according to the look vector, which can be changed with the mouse. Extra's would be a grid shader so that I can see position changes, and beginning to play some movement animations. 

##### Evening
Well, I did most of what I wanted to accomplish. There's a basic LocalAvatarController, WASD changes position based on camera orientation (Only took about an hour). Added a grid shader that I'm relatively happy with, its parameters are driven by the DebugMenu. Didn't investigate animations at all, got distracted by making the OrbitCamera follow an Object3D target. Also made it a bit easier to convert between gl-matrix and ThreeJS vectors, by adding a wrapper around THREE.Vector3. Spent the last hour or two looking at the 100ms+ cost of loading the GLTF. It was shader reflection / error checking, plus an Array conversion in animations. I fixed the latter.

### 2020-03-27
![Daily Screenshot](/screenshots//Screen%20Shot%202020-03-27%20at%207.30.13%20PM.png?raw=true)
* Integrated ThreeJS' animation system. AnimationMixer can now be used to blend and play multiple animations.
* GLTF cubic interpolation for animations is now supported
* ThreeJS' Object3D is now used. This should make it easier to integrate any other three features we may want.

##### To Do
* Make it easier to create objects during resource loading. Their should probably be a POD object for async load, and sync load creates a new full-fat object (for Animation as ThreeJS Clips, Nodes as Object3D, ...)

### 2020-03-26

##### Additions :tada:

* Lots of BMDtoGLTF animation exporting improvements. Animations support cubic splines with tangents. BCKs are now fully supported.
* When a shader fails to compile, it now prints the entire shader source, WITH LINE NUMBERS, before printing the error. Since the errors usually reference line numbers, it's now much easier to fix problems. I should have done this years ago.

##### Fixes :wrench:

* Fixed security vulnerability after notification from GitHub. Minimist needed to be updated to a version >1.2.2. See https://github.com/advisories/GHSA-7fhm-mqm4-2wp7
* During GLTF loading, skins would accidentally transfer the entire GLB buffer over to the main thread so that their ArrayBufferView could access a tiny portion of it. No longer.

### 2020-03-25

* Composite models with multiple SkinnedModels and Models are better supported.
