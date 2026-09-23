import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#000' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
          contentStyle: { backgroundColor: '#000' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Streambert Android' }} />
        <Stack.Screen name="player-test" options={{ title: 'External Player Test' }} />
        <Stack.Screen name="streambert" options={{ title: 'Streambert', headerShown: false }} />
      </Stack>
    </>
  );
}
