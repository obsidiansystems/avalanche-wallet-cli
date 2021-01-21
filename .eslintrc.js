module.exports = {
    "env": {
        "browser": true,
        "commonjs": true,
        "es2021": true
    },
    "extends":
      [ "eslint:recommended"
      , "plugin:node/recommended"
      ],
    "parserOptions": {
        "ecmaVersion": 12
    },
    "rules": {
      "no-constant-condition": "off",
      "no-process-exit": "off", // TODO, this is probably a legit thing to warn about.
      "node/no-unsupported-features/es-syntax": ["error", {
        "version": ">=8.3.0",
        "ignores": []
      }],
      "no-unused-vars": ["error", {
        "varsIgnorePattern": "[iI]gnored"
      }],
    },
};
