# TypeScript with the Interactivity API

The `store()` function infers types from the object you pass in, so most stores don't need explicit types. Server-defined state, local context, and complex/multi-block stores benefit from explicit types.

Install `@wordpress/interactivity` locally so the IDE picks up the types:

```bash
npm install @wordpress/interactivity
```

The `@wordpress/create-block-interactive-template` scaffold has a TypeScript variant:

```bash
npx @wordpress/create-block@latest --template @wordpress/create-block-interactive-template
# Choose the typescript variant when asked. Don't pass a slug — that skips the prompt.
```

## Three typing approaches

### 1. Infer everything from the client store

Works when the entire store is defined client-side in a single `store()` call.

```ts
const { state } = store( 'myCounterPlugin', {
  state: { counter: 0 },
  actions: {
    increment() { state.counter += 1; },
  },
  callbacks: {
    log() { console.log( state.counter ); },
  },
} );
// Inferred:
// state.counter: number, actions.increment(): void, callbacks.log(): void
```

### 2. Type the server state, infer the rest

Use this when some state is initialized in PHP with `wp_interactivity_state()` — that data doesn't appear in your client `store()` call, so TypeScript needs to be told it exists.

```php
wp_interactivity_state( 'myCounterPlugin', array( 'counter' => 1 ) );
```

```ts
type ServerState = {
  state: { counter: number };
};

const storeDef = {
  actions: {
    increment() { state.counter += 1; },
  },
};

type Store = ServerState & typeof storeDef;

const { state } = store< Store >( 'myCounterPlugin', storeDef );
```

Alternative: cast the `state` property and let TS infer the rest.

```ts
type State = { counter: number; product: number };

const { state } = store( 'myCounterPlugin', {
  state: { product: 2 } as State,
  actions: {
    increment() { state.counter * state.product; },
  },
} );
```

### 3. Write all types explicitly

Useful when types live in a shared `.d.ts` for multiple blocks/files.

```ts
interface Store {
  state: { counter: number };
  actions: { increment(): void };
  callbacks: { log(): void };
}

const { state } = store< Store >( 'myCounterPlugin', {
  actions: { increment() { state.counter += 1; } },
  callbacks: { log() { console.log( state.counter ); } },
} );
```

## Typing local context

`data-wp-context` is defined in PHP/HTML, so TypeScript can't infer it. Pass the type to `getContext()`:

```ts
type MyContext = { counter: number };

store( 'myCounterPlugin', {
  actions: {
    increment() {
      const context = getContext< MyContext >();
      context.counter += 1;
    },
  },
} );
```

To avoid repeating the generic, define a typed alias:

```ts
const getMyContext = getContext< MyContext >;
```

## Typing derived state

A derived getter that reads from `state` creates a circular reference TypeScript can't resolve. Add a return-type annotation to break the cycle:

```ts
const { state } = store( 'myCounterPlugin', {
  state: {
    counter: 1,
    get double(): number {        // <-- explicit return type breaks the cycle
      return state.counter * 2;
    },
  },
  actions: {
    increment() { state.counter += 1; }, // now correctly inferred
  },
} );
```

Getters that read only from `getContext()` don't need the annotation — there's no circular dependency on `state` itself.

When the derived value is also seeded on the server, you don't need to add it to the `ServerState` type — the client store definition already provides the type.

## Typing async actions

Async actions are generators. The inferred type is `Promise<ReturnType>` (i.e. they behave like async functions to callers).

```ts
const { state } = store( 'myCounterPlugin', {
  state: { counter: 0 },
  actions: {
    *delayedIncrement() {
      yield new Promise( ( r ) => setTimeout( r, 1000 ) );
      state.counter += 1;
    },
  },
} );
// actions.delayedIncrement: () => Promise<void>
```

When manually typing a store, async actions can be declared as `Promise<T>` directly:

```ts
type Store = {
  actions: { delayedIncrement(): Promise< void > };
};
```

### `AsyncAction<T>` — when state inside a yield causes a circular reference

If an async action yields something derived from `state`, or returns a value derived from `state`, TypeScript may bail to `any` due to a circular reference. Use the `AsyncAction` helper:

```ts
import { store, type AsyncAction } from '@wordpress/interactivity';

const { state } = store( 'myCounterPlugin', {
  state: { counter: 0 },
  actions: {
    *delayedOperation(): AsyncAction< number > {
      yield fetchCounterData( state.counter );
      return state.counter + 1;
    },
  },
} );
```

`AsyncAction<T>` is `Generator<any, T, unknown>`. The `any` on yields breaks the cycle.

### `TypeYield<T>` — typing what a `yield` resolves to

Yielded promises resolve to `any` by default. Cast with `TypeYield`:

```ts
import { type AsyncAction, type TypeYield } from '@wordpress/interactivity';

const fetchCounterData = async ( n: number ): Promise< { current: number; next: number } > => /* ... */;

actions: {
  *loadCounterData(): AsyncAction< void > {
    const data = ( yield fetchCounterData( state.counter ) ) as TypeYield< typeof fetchCounterData >;
    // data is { current: number; next: number }
    state.counter = data.next;
  },
}
```

## Multi-block stores under one namespace

Stores can be split across multiple `view.ts` files. Export the types so other parts can import them.

```ts
// todo-list-block/view.ts
type ServerState = {
  state: { todos: string[]; filter: 'all' | 'completed' };
};

const todoList = {
  state: {
    get filteredTodos(): string[] {
      return state.filter === 'completed'
        ? state.todos.filter( ( t ) => t.includes( '✅' ) )
        : state.todos;
    },
  },
  actions: {
    addTodo( todo: string ) { state.todos.push( todo ); },
  },
};

export type TodoList = ServerState & typeof todoList;

const { state } = store< TodoList >( 'myTodoPlugin', todoList );
```

```ts
// add-post-to-todo-block/view.ts
import type { TodoList } from '../todo-list-block/view';

type ServerState = { state: { postTitle: string } };

const addPostToTodo = {
  actions: {
    addPostToTodo() {
      const todo = `Read: ${ state.postTitle }`.trim();
      if ( ! state.todos.includes( todo ) ) {
        actions.addTodo( todo );
      }
    },
  },
};

type Store = TodoList & ServerState & typeof addPostToTodo;

const { state, actions } = store< Store >( 'myTodoPlugin', addPostToTodo );
```

For a centralized type, define an `interface Store` in a shared `types.ts` and pass it to every `store< Store >( … )` call.

## Importing typed stores across namespaces

If a different plugin owns a store and you want type safety when reading its data, the owning plugin can **export** its typed store as a script module, and you import from it.

```ts
// my-todo-plugin entry — exports typed handles.
export const { state, actions } = store< TodoList >( 'myTodoPlugin', { /* ... */ } );
```

```ts
// consumer
import { store } from '@wordpress/interactivity';
import { state as todoState, actions as todoActions } from 'my-todo-plugin-module';

store( 'myAddPostToTodoPlugin', {
  actions: {
    addPostToTodo() {
      const todo = `Read: ${ state.postTitle }`.trim();
      if ( ! todoState.todos.includes( todo ) ) {
        todoActions.addTodo( todo );
      }
    },
  },
} );
```

Declare `my-todo-plugin-module` as a script module dependency. For optional integration, dynamic-import it inside an async action instead:

```ts
*addPostToTodo() {
  const todoPlugin = yield import( 'my-todo-plugin-module' );
  if ( ! todoPlugin.state.todos.includes( todo ) ) {
    todoPlugin.actions.addTodo( todo );
  }
}
```
