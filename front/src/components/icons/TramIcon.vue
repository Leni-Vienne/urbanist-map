<template>
  <!-- Square viewBox framing the artwork with lucide's ~83% content-to-box ratio, so the icon
       sits at the same optical size as the lucide icons it stands beside. -->
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="5 5 240 240"
    fill="currentColor"
    aria-hidden="true"
  >
    <!-- Pantograph -->
    <path
      d="M79 42 L111 69 L83 92"
      fill="none"
      stroke="currentColor"
      stroke-width="12"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <!-- Body, with the windows and door cut out by the even-odd rule -->
    <path
      fill-rule="evenodd"
      d="
        M25 87
        H181
        C192 87 200 95 207 105
        C217 119 225 138 225 151
        C225 171 209 187 189 187
        H25
        V150
        H61
        C62.7 150 64 148.7 64 147
        V102
        C64 100.3 62.7 99 61 99
        H25
        Z

        M75 99
        H100
        V177
        H75
        Z

        M112 99
        H138
        V177
        H112
        Z

        M149 99
        H181
        C188 99 194 106 199 114
        C205 123 210 134 211.5 143
        C212.2 147 209.4 150 205.5 150
        H149
        Z
      "
    />

    <!-- Rail. 15 units in this 240-unit viewBox matches lucide's 1.5-in-24 stroke weight. -->
    <rect x="25" y="198" width="200" height="13" rx="3" />
  </svg>
</template>
