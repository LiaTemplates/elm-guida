<!--
author:   André Dietrich
email:    LiaScript@web.de
version:  0.0.1
language: en
narrator: US English Female
comment:  Write, compile and run Elm programs directly in LiaScript, with the
          Guida compiler running completely in the browser.

script:   dist/index.js

attribute: [Guida](https://github.com/guida-lang/compiler) by Décio Ferreira
           is licensed under [BSD-3-Clause](https://github.com/guida-lang/compiler/blob/master/LICENSE)

@Elm.eval:  @Elm.eval_(@uid,dev)
@Elm.debug: @Elm.eval_(@uid,debug)
@Elm.repl:  @Elm.repl_(@uid)

@Elm.eval_
<script>
(function () {
  const first = `@'input(0)`
  const more = [`@'input(1)`, `@'input(2)`, `@'input(3)`, `@'input(4)`,
                `@'input(5)`, `@'input(6)`, `@'input(7)`, `@'input(8)`, `@'input(9)`]
  const inputs = [first]
  for (let i = 0; i < more.length; i++) {
    // a missing listing N shows up as "<first listing>(N)"
    if (more[i] === first + "(" + (i + 1) + ")") break
    inputs.push(more[i])
  }

  if (!window.ElmGuida) {
    send.lia("The Elm compiler (dist/index.js) is not loaded.", [], false)
  } else {
    window.ElmGuida.run({ uid: "@0", inputs, send, console, mode: "@1" })
  }
})()
"LIA: wait"
</script>
@end

@Elm.repl_
<script>
(function () {
  const first = `@'input(0)`
  const more = [`@'input(1)`, `@'input(2)`, `@'input(3)`, `@'input(4)`,
                `@'input(5)`, `@'input(6)`, `@'input(7)`, `@'input(8)`, `@'input(9)`]
  const inputs = [first]
  for (let i = 0; i < more.length; i++) {
    // a missing listing N shows up as "<first listing>(N)"
    if (more[i] === first + "(" + (i + 1) + ")") break
    inputs.push(more[i])
  }

  if (!window.ElmGuida) {
    send.lia("The Elm compiler (dist/index.js) is not loaded.", [], false)
  } else {
    window.ElmGuida.repl({ uid: "@0", inputs, send, console })
  }
})()
"LIA: terminal"
</script>
@end

-->

# Elm (Guida) - Template

    --{{0}}--
This template compiles and runs [Elm](https://elm-lang.org) programs inside a
LiaScript course. The compiler is [Guida](https://github.com/guida-lang/compiler),
a port of the Elm 0.19.1 compiler to Elm itself, compiled to JavaScript. Nothing
is sent to a server: the code is compiled in the browser of the learner.

__Try it on LiaScript:__

https://liascript.github.io/course/?https://raw.githubusercontent.com/LiaTemplates/elm-guida/main/README.md

__See the project on GitHub:__

https://github.com/LiaTemplates/elm-guida

                         --{{1}}--
There are three ways to use this template. The easiest is to load the macros
dynamically into your project, with the import statement in the header of
your course.

{{1}}
1. Load the macros dynamically, either the latest version or a pinned one:

   `import: https://raw.githubusercontent.com/LiaTemplates/elm-guida/main/README.md`

   or

   `import: https://raw.githubusercontent.com/LiaTemplates/elm-guida/0.0.1/README.md`

2. Copy the definitions into your project

3. Clone this repository on GitHub

__How it works:__

* The packages of the official Elm guide come precompiled with the template
  (`dist/packages.zip`, about 570 kB): `elm/core`, `html`, `browser`, `json`,
  `http`, `random`, `time`, `svg`, `url`, `file`, `bytes`, `parser` and
  `virtual-dom`. The first run unpacks them into the IndexedDB of the
  browser, then every compile takes about two seconds and works offline.
* The `elm.json` is made from the `import`s of your code (`Http`, `Json`,
  `Random`, `Time`, `Svg`, …). For other packages, add your own `elm.json` as
  a listing (see below). Packages that are not preloaded are downloaded from
  the Guida package registry https://package.guida-lang.org, which needs a
  connection.
* The compiled program runs in a frame below the code. `Debug.log` output
  goes to the terminal of the code block.

## `@Elm.eval`

    --{{0}}--
Put `@Elm.eval` directly below an Elm code block. Click the run button: the
code is compiled and the program runs below it. Change the code and run it
again.

``` elm
module Main exposing (..)

-- Press buttons to increment and decrement a counter.
--
-- Read how it works:
--   https://guide.elm-lang.org/architecture/buttons.html

import Browser
import Html exposing (Html, button, div, text)
import Html.Events exposing (onClick)


-- MAIN

main =
  Browser.sandbox { init = init, update = update, view = view }


-- MODEL

type alias Model = Int

init : Model
init =
  0


-- UPDATE

type Msg
  = Increment
  | Decrement

update : Msg -> Model -> Model
update msg model =
  case msg of
    Increment ->
      model + 1

    Decrement ->
      model - 1


-- VIEW

view : Model -> Html Msg
view model =
  div []
    [ button [ onClick Decrement ] [ text "-" ]
    , div [] [ text (String.fromInt model) ]
    , button [ onClick Increment ] [ text "+" ]
    ]
```
@Elm.eval

### Compiler errors

    --{{0}}--
The friendly error messages of Elm are shown in the terminal, and the lines
are marked in the editor. Run this example and fix the error.

``` elm
module Main exposing (main)

import Html exposing (text)


main =
  text ("The answer is " ++ 42)
```
@Elm.eval

### `Debug.log`

    --{{0}}--
Everything a program writes to the console, e.g. with `Debug.log`, shows up in
the terminal of the code block.

``` elm
module Main exposing (main)

import Browser
import Html exposing (Html, button, div, text)
import Html.Events exposing (onClick)


main =
  Browser.sandbox { init = 0, update = update, view = view }


update : Int -> Int -> Int
update step model =
  Debug.log "model" (model + step)


view : Int -> Html Int
view model =
  div []
    [ button [ onClick 1 ] [ text "+1" ]
    , button [ onClick 10 ] [ text "+10" ]
    , text (" " ++ String.fromInt model)
    ]
```
@Elm.eval

## `@Elm.repl`

    --{{0}}--
`@Elm.repl` turns the code block into an Elm REPL, as in the chapter "Core
Language" of the guide. The code block is evaluated first, then you can type
more expressions, definitions, types and imports into the terminal below,
for example `x |> List.sort`. End a line with `\` to continue on the next
line; `:help` lists the commands.

``` elm
x = [3,2,1]

greet name =
  "Hello, " ++ name ++ "!"

greet "Alice"
```
@Elm.repl

## `@Elm.debug`

    --{{0}}--
`@Elm.debug` compiles in debug mode: the Elm debugger appears in the lower
right corner of the program. Click it to travel back in time through all
messages.

``` elm
module Main exposing (main)

import Browser
import Html exposing (Html, Attribute, div, input, text)
import Html.Attributes exposing (..)
import Html.Events exposing (onInput)


-- https://guide.elm-lang.org/architecture/text_fields.html

main =
  Browser.sandbox { init = init, update = update, view = view }


type alias Model =
  { content : String
  }


init : Model
init =
  { content = "" }


type Msg
  = Change String


update : Msg -> Model -> Model
update msg model =
  case msg of
    Change newContent ->
      { model | content = newContent }


view : Model -> Html Msg
view model =
  div [ style "min-height" "120px" ]
    [ input [ placeholder "Text to reverse", value model.content, onInput Change ] []
    , div [] [ text (String.reverse model.content) ]
    ]
```
@Elm.debug

## Several modules

    --{{0}}--
A code block can have several listings. Every listing that starts with
`module Name exposing …` becomes the file `src/Name.elm`. The first listing
is the program that is started.

``` elm Main.elm
module Main exposing (main)

import Html exposing (text)
import Greeting


main =
  text (Greeting.hello "LiaScript")
```
``` elm Greeting.elm
module Greeting exposing (hello)


hello : String -> String
hello name =
  "Hello, " ++ name ++ "!"
```
@Elm.eval

## Own `elm.json`

    --{{0}}--
A listing that starts with `{` is used as the `elm.json` of the project. Use
it for packages that are not picked automatically, e.g.
`"elm-community/list-extra": "8.7.0"`. Packages that are not preloaded are
downloaded from the Guida package registry, so they need a connection to
https://package.guida-lang.org.

``` elm Main.elm
module Main exposing (main)

import Html exposing (text)
import Parser exposing ((|.), (|=), Parser, int, spaces, symbol)


point : Parser ( Int, Int )
point =
  Parser.succeed Tuple.pair
    |. symbol "("
    |. spaces
    |= int
    |. spaces
    |. symbol ","
    |. spaces
    |= int
    |. spaces
    |. symbol ")"


main =
  text (Debug.toString (Parser.run point "( 3, 4 )"))
```
``` json -elm.json
{
    "type": "application",
    "source-directories": [
        "src"
    ],
    "elm-version": "0.19.1",
    "dependencies": {
        "direct": {
            "elm/browser": "1.0.2",
            "elm/core": "1.0.5",
            "elm/html": "1.0.1",
            "elm/parser": "1.1.0"
        },
        "indirect": {
            "elm/json": "1.1.4",
            "elm/time": "1.0.0",
            "elm/url": "1.0.0",
            "elm/virtual-dom": "1.0.5"
        }
    },
    "test-dependencies": {
        "direct": {},
        "indirect": {}
    }
}
```
@Elm.eval

## HTTP

    --{{0}}--
The programs can talk to servers, as long as the server allows requests from
the browser (CORS). This is the HTTP example of the official guide.

``` elm
module Main exposing (main)

-- https://guide.elm-lang.org/effects/http.html

import Browser
import Html exposing (Html, text, pre)
import Http


main =
  Browser.element
    { init = init
    , update = update
    , subscriptions = subscriptions
    , view = view
    }


type Model
  = Failure
  | Loading
  | Success String


init : () -> (Model, Cmd Msg)
init _ =
  ( Loading
  , Http.get
      { url = "https://elm-lang.org/assets/public-opinion.txt"
      , expect = Http.expectString GotText
      }
  )


type Msg
  = GotText (Result Http.Error String)


update : Msg -> Model -> (Model, Cmd Msg)
update msg model =
  case msg of
    GotText result ->
      case result of
        Ok fullText ->
          (Success fullText, Cmd.none)

        Err _ ->
          (Failure, Cmd.none)


subscriptions : Model -> Sub Msg
subscriptions model =
  Sub.none


view : Model -> Html Msg
view model =
  case model of
    Failure ->
      text "I was unable to load your book."

    Loading ->
      text "Loading..."

    Success fullText ->
      pre [] [ text fullText ]
```
@Elm.eval

## Own HTML page (ports and flags)

    --{{0}}--
A listing that starts with `<` is used as the HTML page of the program. The
compiled JavaScript replaces `<script src="main.js"></script>` (also `elm.js`
or `index.js`), so the page can start the program with flags and connect
ports, as in the JavaScript interop chapter of the guide.

``` elm Main.elm
port module Main exposing (main)

import Browser
import Html exposing (Html, button, div, input, text, ul, li)
import Html.Attributes exposing (value)
import Html.Events exposing (onClick, onInput)


port sendMessage : String -> Cmd msg
port messageReceiver : (String -> msg) -> Sub msg


main : Program String Model Msg
main =
  Browser.element
    { init = \greeting -> ( { draft = "", messages = [ greeting ] }, Cmd.none )
    , view = view
    , update = update
    , subscriptions = \_ -> messageReceiver Recv
    }


type alias Model =
  { draft : String
  , messages : List String
  }


type Msg
  = DraftChanged String
  | Send
  | Recv String


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
  case msg of
    DraftChanged draft ->
      ( { model | draft = draft }, Cmd.none )

    Send ->
      ( { model | draft = "" }, sendMessage model.draft )

    Recv message ->
      ( { model | messages = model.messages ++ [ message ] }, Cmd.none )


view : Model -> Html Msg
view model =
  div []
    [ ul [] (List.map (\m -> li [] [ text m ]) model.messages)
    , input [ onInput DraftChanged, value model.draft ] []
    , button [ onClick Send ] [ text "Send" ]
    ]
```
``` html index.html
<!DOCTYPE HTML>
<html>
<head>
  <meta charset="UTF-8">
  <script src="main.js"></script>
</head>
<body>
  <div id="myapp"></div>
  <script>
  var app = Elm.Main.init({
    node: document.getElementById('myapp'),
    flags: "Hello from JavaScript!"
  });

  // Elm -> JavaScript -> Elm: echo every message in upper case
  app.ports.sendMessage.subscribe(function (message) {
    app.ports.messageReceiver.send("JS: " + message.toUpperCase());
  });
  </script>
</body>
</html>
```
@Elm.eval

## JavaScript API

    --{{0}}--
The bundle puts the object `ElmGuida` on `window`. You can use it in your own
scripts.

| Function                                    | Result                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ElmGuida.compile(listings, { mode })`      | Promise of `{ html }` (a complete HTML page) or `{ error }` (Elm's JSON report)              |
| `ElmGuida.format(code)`                     | Promise of the code formatted like `elm-format`                                              |
| `ElmGuida.defaultElmJson(listings)`         | the `elm.json` that is used when a code block has none                                       |
| `ElmGuida.reset()`                          | deletes all cached packages and projects from the IndexedDB                                  |

`mode` is `"dev"`, `"debug"` or `"optimize"`. `listings` is a list of
strings, sorted like the listings of a code block.

<script run-once modify="false" style="display:block">
async function demo() {
  const result = await ElmGuida.format("module Main exposing (main)\nimport Html\nmain = Html.text   \"formatted\"")
  send.lia("HTML: <pre>" + result.replace(/</g, "&lt;") + "</pre>")
}
setTimeout(demo, 100)
"LIA: wait"
</script>

## Implementation

    --{{0}}--
The compiler and its glue code are bundled with [Parcel](https://parceljs.org)
into `dist/index.js` (see `src/index.js`). Build it with `npm install` and
`npm run build`.

```` markdown
script:   dist/index.js

@Elm.eval:  @Elm.eval_(@uid,dev)
@Elm.debug: @Elm.eval_(@uid,debug)
@Elm.repl:  @Elm.repl_(@uid)

@Elm.eval_
<script>
(function () {
  const first = `@'input(0)`
  const more = [`@'input(1)`, `@'input(2)`, `@'input(3)`, `@'input(4)`,
                `@'input(5)`, `@'input(6)`, `@'input(7)`, `@'input(8)`, `@'input(9)`]
  const inputs = [first]
  for (let i = 0; i < more.length; i++) {
    // a missing listing N shows up as "<first listing>(N)"
    if (more[i] === first + "(" + (i + 1) + ")") break
    inputs.push(more[i])
  }

  if (!window.ElmGuida) {
    send.lia("The Elm compiler (dist/index.js) is not loaded.", [], false)
  } else {
    window.ElmGuida.run({ uid: "@0", inputs, send, console, mode: "@1" })
  }
})()
"LIA: wait"
</script>
@end

@Elm.repl_
<script>
(function () {
  const first = `@'input(0)`
  const more = [`@'input(1)`, `@'input(2)`, `@'input(3)`, `@'input(4)`,
                `@'input(5)`, `@'input(6)`, `@'input(7)`, `@'input(8)`, `@'input(9)`]
  const inputs = [first]
  for (let i = 0; i < more.length; i++) {
    // a missing listing N shows up as "<first listing>(N)"
    if (more[i] === first + "(" + (i + 1) + ")") break
    inputs.push(more[i])
  }

  if (!window.ElmGuida) {
    send.lia("The Elm compiler (dist/index.js) is not loaded.", [], false)
  } else {
    window.ElmGuida.repl({ uid: "@0", inputs, send, console })
  }
})()
"LIA: terminal"
</script>
@end
````
