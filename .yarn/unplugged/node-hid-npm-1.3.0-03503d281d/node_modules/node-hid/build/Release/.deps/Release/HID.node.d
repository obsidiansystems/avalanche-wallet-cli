cmd_Release/HID.node := ln -f "Release/obj.target/HID.node" "Release/HID.node" 2>/dev/null || (rm -rf "Release/HID.node" && cp -af "Release/obj.target/HID.node" "Release/HID.node")
