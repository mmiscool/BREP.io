# JS-virtual-Touchpad
Its like having a mouse in your mobile browser. 

<img src="https://github.com/mmiscool/JS-virtual-Touchpad/assets/6439772/664d0ff0-2827-494a-94b7-b26d64ef3539" width="300px">

# Basic functionality
This project provides a basic emulation of a laptop touchpad that can be overlayed over an application designed for desktop use. The touchpad shows up as a mostly transparent overlay over your web application. 


# Usage instructions 
To use copy the "mouse.html" file and "mouse" folder to the same directory hosting your web application. 

In your web application add the following line to the index.html file.
```
<script src="./mouse/checkIfMobile.js"></script>
```

Now visit your application from a mobile browser. 

If you want to test on a desktop type device you will have togo to the /mouse.html file directly as it will not automatically redirect to use the virtual touchpad unless it detects you are on a mobile device. 

# troubleshooting 
On some sites setting the page to full screen will not work correctly. If you run in to an issue with the iframe contents not showing up correctly comment out the following line in ./mouse/mouseController.js
```
if (window.innerHeight !== screen.height) document.body.requestFullscreen();
```

# In-depth explanation of how it works 
See article: 
https://medium.com/@admin_11488/bridging-the-gap-making-a-desktop-web-app-mobile-friendly-with-a-virtual-mouse-touchpad-e37b69835a9f

# Reason this thing exists 
JSketcher is a browser based CAD modeler. I wanted to make it work better on mobile for actually creating models. Not Just viewing. After making this code work in JSKetcher with a few customizations specific to JSketcher I extracted the code and cleaned it up to work more generically. 
JSketcher project is located here. https://github.com/xibyte/jsketcher
