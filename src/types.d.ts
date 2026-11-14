declare module '../App.js' {
  const App: React.ComponentType<any>;
  export default App;
}

declare module 'react-native' {
  export * from './web-shims/react-native';
}

declare module '@react-native-async-storage/async-storage' {
  import AsyncStorage from './web-shims/async-storage';
  export default AsyncStorage;
}
