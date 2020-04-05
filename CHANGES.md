Change Log
==========

##### TODO
* Pivot around whichever foot is grounded, or lerp between them if in the air
* Improve stopping from running. Maybe a small skid?
* Skidding 180 when about facing along the vertical axis
* Touch axes

### 2020-06-03
Implement and solidify touch axes so that I can control the avatar on mobile. Clean up mobile HTML/CSS issues so that there is no scrolling and the app goes fullscreen on touch. Maybe implement some "safe zones" on the sides? I.e. areas where no important objects are so that there's always a place to slap down your pudgy fingers without hiding anything from view. We could just treat the 4:3 center of the screen as the only visible area when computing cameras. Probably a bit early for this. Mobile Day!

If all that gets done it's probably a good idea to write the Mouse input handler, I've been putting that off. That could be used to implement Debug Cam. 

Oh! And I should add access to the debug menu on mobile. Probably touching the top right corner.

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
