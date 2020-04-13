Change Log
==========

##### TODO
* Pivot around whichever foot is grounded, or lerp between them if in the air
* Improve stopping from running. Maybe a small skid?
* Skidding 180 when about facing along the vertical axis

### 2020-13-03
##### Morning
Over the weekend I read a lot of Glen Fiedler articles (https://gafferongames.com/post/reliability_ordering_and_congestion_avoidance_over_udp/). I think the first thing I'm going to do is implement a reliability protocol, via ACKs, so that I can send some reliable messages such as client connected, and detect client ping. After that I'll look into different pre-rolled packet schemas so that I can avoid writing a lot of boilerplate serialization/schema code on the server side. I was hoping that flatbuffers would work, but it looks like they don't support min/max values for validation. Hopefully I'll be able to find an open source protocol, otherwise I'll write my own. 

I need to restructure the way that AvatarController and AvatarRender work in order to support multiplayer. There should be an AvatarState array that AvatarRender consumes to pose and render each character. AvatarController, multiplayer packets, and any AI would all be able to modify the AvatarState. If I have time today I'd like to start on that as well. 

##### Evening
It was a productive day, but I underestimated how much work the reliability protocol would be. At 6PM I had it tested (lightly) and working. I basically followed the main idea of the Fiedler article linked above, with 16-bit sequence numbers. Tomorrow I'd like to do some more testing to make sure it's actually working how I think it's working. That probably means adding an API to request a reliable message and then resending it if it fails to be ack'd within the valid time. This requires simulating dropped packets. Can we do this in Chrome? Otherwise I'll have to write some code at the UDP layer to simulate drops.

### 2020-10-03
##### Morning
First off, get the game to send pings to the example EchoServer from https://github.com/seemk/WebUDP, which I currently have running in a Docker instance. Then I'll start a new project to write the game server and start sending custom messages to the clients. Hopefully by the end of the day two clients can be notified of each others existence.

##### Evening
Good day! Got the game talking to the sample server. Set up a new project with a dockerfile that builds the WebUDP project, and links it to a new sample server. https://github.com/themikelester/MoonServer. Had the server relay connect messages to all connected clients, first client->client communication! Next up I'll try to hack in some positional data so that multiple avatars can be seen. 

### 2020-09-03
##### Morning
Same again as yesterday. Time to pound out some libwebrtc builds!

##### Evening
Yes! I spent a few hours and got a bit further trying to build Google's libwebrtc, then got disheartened and went hunting for some other C++ webrtc implementations. Jackpot! Found https://github.com/seemk/WebUDP. Was stuck for a long time trying to get the example running. The server was building and the client was sending at least one TCP message to the server, but it wasn't establishing the rtc connection. Finally figured out that I needed to docker publish not only the :9555 port (which defaults to TCP) but also the :9555/udp port. Apparently the webrtc implementation in JS sends a udp message to the other peer after the SDP is established. Woohoo! 

### 2020-08-03
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

### 2020-07-03
##### Morning
Oh forgot to mention, I purchased the moonduel.io domain, and hooked it up to the github pages page. Today I plan on getting a Ubuntu docker instance set up, and try to get the client-server WebRTC example from http://blog.brkho.com/2017/03/15/dive-into-client-server-web-games-webrtc/ up and running. Then I'll try to adapt the client code so that I can connect to the server from instances of my client.

##### Evening
MY GOODNESS. Building libwebrtc is quite a chore. I spent the day trying to work through the blog post linked above. Most of that was learning about docker and trying to write a Dockerfile for his project so that I could get it building on Ubuntu. The compile step for libwebrtc takes at least 20 minutes on my machine, and I had to do it three times. I'm currently stuck on getting the project to 'make'. cmake seems to be failing to include the necessary include directories from the LibWebRTC dependency. I'll be looking into that tomorrow.

Of note, I'm not using the install scripts that he linked in the original blog post, but a fork that has been updated to work with the latest libwebrtc "release" which as of now is 72, from early 2019. https://github.com/cloudwebrtc/libwebrtc-build

### 2020-06-03
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
