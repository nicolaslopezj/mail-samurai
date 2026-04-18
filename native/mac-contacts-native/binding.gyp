{
  "targets": [
    {
      "target_name": "mac_contacts_native",
      "sources": [ "src/contacts.mm" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [ "NAPI_CPP_EXCEPTIONS" ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "12.0",
        "OTHER_CPLUSPLUSFLAGS": [ "-std=c++17" ]
      },
      "libraries": [
        "-framework Contacts",
        "-framework Foundation"
      ]
    }
  ]
}
