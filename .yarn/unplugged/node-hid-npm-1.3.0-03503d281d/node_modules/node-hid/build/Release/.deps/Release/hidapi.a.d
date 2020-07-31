cmd_Release/hidapi.a := ln -f "Release/obj.target/hidapi.a" "Release/hidapi.a" 2>/dev/null || (rm -rf "Release/hidapi.a" && cp -af "Release/obj.target/hidapi.a" "Release/hidapi.a")
