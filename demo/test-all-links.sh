#!/bin/bash
# Comprehensive OSC 8 Hyperlink Test Suite
# Tests all aspects of hyperlink rendering and interaction

echo "🔗 OSC 8 Hyperlink Test Suite"
echo "=============================="
echo ""

# Function to create OSC 8 hyperlink
# Usage: osc8_link URL TEXT
osc8_link() {
    printf '\e]8;;%s\e\\%s\e]8;;\e\\' "$1" "$2"
}

echo "Test 1: Simple single-line link"
osc8_link "https://github.com" "GitHub"
echo ""
echo ""

echo "Test 2: Link with long display text"
osc8_link "https://example.com/very/long/path" "This is a very long link text that should render properly"
echo ""
echo ""

echo "Test 3: Multi-line wrapped link (80+ chars)"
osc8_link "https://github.com/ghostty-org/ghostty" "This is an extremely long link text that will definitely wrap across multiple lines when displayed in an 80 column terminal window"
echo ""
echo ""

echo "Test 4: Multiple links on same line"
osc8_link "https://google.com" "Google"
echo -n " | "
osc8_link "https://github.com" "GitHub"
echo -n " | "
osc8_link "https://stackoverflow.com" "StackOverflow"
echo ""
echo ""

echo "Test 5: Link with URL query parameters"
osc8_link "https://example.com/search?q=test&lang=en" "Search Results"
echo ""
echo ""

echo "Test 6: Link with Unicode/emoji"
osc8_link "https://unicode.org" "Unicode 🌍 Emoji 🎉 Test"
echo ""
echo ""

echo "Test 7: Consecutive links (no space)"
osc8_link "https://a.com" "LinkA"
osc8_link "https://b.com" "LinkB"
osc8_link "https://c.com" "LinkC"
echo ""
echo ""

echo "Test 8: Links with ANSI color codes"
printf '\e[1;31m'  # Red bold
osc8_link "https://red.com" "Red Link"
printf '\e[0m | '
printf '\e[1;32m'  # Green bold
osc8_link "https://green.com" "Green Link"
printf '\e[0m | '
printf '\e[1;34m'  # Blue bold
osc8_link "https://blue.com" "Blue Link"
printf '\e[0m'
echo ""
echo ""

echo "Test 9: Very long URL (short text)"
osc8_link "https://example.com/very/long/path/with/many/segments/and/parameters?param1=value1&param2=value2&param3=value3" "Short"
echo ""
echo ""

echo "Test 10: Link with ID parameter (same URL, different IDs)"
printf '\e]8;id=link1;https://example.com\e\\First Instance\e]8;;\e\\'
echo -n " and "
printf '\e]8;id=link2;https://example.com\e\\Second Instance\e]8;;\e\\'
echo ""
echo ""

echo "Test 11: File:// URL"
osc8_link "file:///home/user/document.txt" "Local File"
echo ""
echo ""

echo "Test 12: Mailto: link"
osc8_link "mailto:test@example.com" "Email Link"
echo ""
echo ""

echo "Test 13: FTP link"
osc8_link "ftp://ftp.example.com/file.zip" "FTP Download"
echo ""
echo ""

echo "Test 14: Link spanning terminal width"
osc8_link "https://github.com/ghostty-org/ghostty-web-xterm" "012345678901234567890123456789012345678901234567890123456789012345678901234567890"
echo ""
echo ""

echo "Test 15: Links with bold/italic styles"
printf '\e[1m'  # Bold
osc8_link "https://bold.com" "Bold Link"
printf '\e[0m | '
printf '\e[3m'  # Italic
osc8_link "https://italic.com" "Italic Link"
printf '\e[0m | '
printf '\e[1;3m'  # Bold + Italic
osc8_link "https://both.com" "Bold+Italic Link"
printf '\e[0m'
echo ""
echo ""

echo "=============================="
echo "✅ Test suite complete!"
echo ""
echo "Instructions:"
echo "1. Hover over any blue underlined text"
echo "2. Hold Ctrl (or Cmd on Mac) and click to open"
echo "3. Multi-line links should have continuous underlines"
echo "4. Each link should open its correct URL"
